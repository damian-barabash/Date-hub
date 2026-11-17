-- Документы: на сервере хранится только извлечённый текст и поля (файлы, фото и видео не загружаются).
create extension if not exists unaccent;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  path text not null default '',           -- папка-источник («AUDYT/Materiały»)
  ext text,
  size bigint,
  source text not null default 'upload',   -- upload | folder | drive
  source_url text,
  hash text unique,                        -- защита от повторной загрузки того же текста
  category text,                           -- вкладка меню (задаёт ИИ, максимум 15 на всё приложение)
  doc_type text,                           -- faktura, zamówienie, umowa, raport, prezentacja, protokół…
  summary text,
  doc_date date,
  counterparty text,
  number text,
  net numeric, vat numeric, gross numeric, currency text,
  meta jsonb not null default '{}',
  pages int, chars int not null default 0,
  ocr boolean not null default false,
  status text not null default 'new',      -- new | ready | error
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists documents_category_idx on public.documents (category);
create index if not exists documents_date_idx on public.documents (doc_date);

create table if not exists public.doc_chunks (
  id bigserial primary key,
  doc_id uuid not null references public.documents on delete cascade,
  idx int not null,
  content text not null,
  tsv tsvector
);
create index if not exists doc_chunks_doc_idx on public.doc_chunks (doc_id, idx);
create index if not exists doc_chunks_tsv_idx on public.doc_chunks using gin (tsv);

alter table public.documents enable row level security;
alter table public.doc_chunks enable row level security;
drop policy if exists auth_all on public.documents;
create policy auth_all on public.documents for all to authenticated using (true) with check (true);
drop policy if exists auth_read on public.doc_chunks;
create policy auth_read on public.doc_chunks for select to authenticated using (true);
-- SQL ИИ: аналитика по полям документов (суммы по месяцам, контрагентам…); сам текст — через поиск
grant select on public.documents to ai_reader;
drop policy if exists ai_read on public.documents;
create policy ai_read on public.documents for select to ai_reader using (true);

create or replace function public._norm(t text) returns text
language sql stable as $$ select lower(public.unaccent(coalesce(t, ''))) $$;

-- запрос → tsquery с префиксами: в польском слова склоняются, поэтому ищем по основе («faktur:*»)
create or replace function public._doc_query(q text) returns tsquery
language plpgsql stable as $$
declare w text; parts text[] := '{}'; s text;
begin
  for w in select m[1] from regexp_matches(public._norm(q), '[a-z0-9]{2,}', 'g') m loop
    s := case when length(w) > 6 then left(w, length(w) - 2) when length(w) > 4 then left(w, length(w) - 1) else w end;
    parts := parts || (s || ':*');
  end loop;
  if array_length(parts, 1) is null then return null; end if;
  return to_tsquery('simple', array_to_string(parts, ' | '));
end $$;

-- сохранить документ и его текст (кусками); повтор по hash заменяет прежнюю версию
create or replace function public.doc_upsert(p_doc jsonb, p_chunks text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; i int;
begin
  perform public._req();
  if coalesce(array_length(p_chunks, 1), 0) = 0 then raise exception 'empty document'; end if;
  select id into v_id from public.documents where hash = p_doc->>'hash';
  if v_id is not null then
    delete from public.doc_chunks where doc_id = v_id;
    update public.documents set title = p_doc->>'title', path = coalesce(p_doc->>'path', ''), ext = p_doc->>'ext',
      size = (p_doc->>'size')::bigint, source = coalesce(p_doc->>'source', 'upload'), source_url = p_doc->>'source_url',
      pages = (p_doc->>'pages')::int, ocr = coalesce((p_doc->>'ocr')::boolean, false) where id = v_id;
  else
    insert into public.documents (title, path, ext, size, source, source_url, hash, pages, ocr)
    values (p_doc->>'title', coalesce(p_doc->>'path', ''), p_doc->>'ext', (p_doc->>'size')::bigint, coalesce(p_doc->>'source', 'upload'),
            p_doc->>'source_url', p_doc->>'hash', (p_doc->>'pages')::int, coalesce((p_doc->>'ocr')::boolean, false))
    returning id into v_id;
  end if;
  for i in 1..array_length(p_chunks, 1) loop
    insert into public.doc_chunks (doc_id, idx, content, tsv)
    values (v_id, i - 1, p_chunks[i], to_tsvector('simple', public._norm(p_chunks[i])));
  end loop;
  update public.documents set chars = (select coalesce(sum(length(content)), 0) from public.doc_chunks where doc_id = v_id) where id = v_id;
  return v_id;
end $$;

-- поиск по тексту: лучшие фрагменты (по одному–двум на документ)
create or replace function public.doc_search(p_q text, p_limit int default 8, p_category text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q tsquery := public._doc_query(p_q); v_res jsonb;
begin
  perform public._req();
  if q is null then return '[]'; end if;
  select coalesce(jsonb_agg(t order by t.rank desc), '[]') into v_res from (
    select * from (
      select d.id, d.title, d.path, d.category, d.doc_type, d.doc_date, c.idx,
             ts_rank(c.tsv, q) + case when to_tsvector('simple', public._norm(d.title || ' ' || d.path)) @@ q then 0.3 else 0 end as rank,
             c.content, row_number() over (partition by d.id order by ts_rank(c.tsv, q) desc) rn
      from public.doc_chunks c join public.documents d on d.id = c.doc_id
      where c.tsv @@ q and (p_category is null or d.category = p_category)
    ) x where rn <= 2 order by rank desc limit least(p_limit, 30)
  ) t;
  return v_res;
end $$;

create or replace function public.doc_text(p_id uuid, p_from int default 0, p_count int default 6) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('chunks', (select count(*) from public.doc_chunks where doc_id = p_id),
    'text', (select string_agg(content, E'\n' order by idx) from (select idx, content from public.doc_chunks where doc_id = p_id and idx >= p_from order by idx limit least(p_count, 40)) s))
$$;

revoke execute on function public.doc_upsert(jsonb, text[]), public.doc_search(text, int, text), public.doc_text(uuid, int, int) from public, anon;
grant execute on function public.doc_upsert(jsonb, text[]), public.doc_search(text, int, text), public.doc_text(uuid, int, int) to authenticated, service_role;
grant execute on function public._norm(text), public._doc_query(text) to authenticated, service_role;

-- сводка для ИИ и меню: сколько документов, по категориям и типам
create or replace function public.doc_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total', (select count(*) from public.documents),
    'pending', (select count(*) from public.documents where status = 'new'),
    'min_date', (select min(doc_date) from public.documents), 'max_date', (select max(doc_date) from public.documents),
    'cats', (select coalesce(jsonb_agg(t order by t.n desc), '[]') from (select coalesce(category, '—') category, count(*) n, sum(gross) gross from public.documents group by 1) t),
    'types', (select coalesce(jsonb_agg(t order by t.n desc), '[]') from (select coalesce(doc_type, '—') doc_type, count(*) n from public.documents group by 1 order by 2 desc limit 20) t))
$$;
revoke execute on function public.doc_stats() from public, anon;
grant execute on function public.doc_stats() to authenticated, service_role;
