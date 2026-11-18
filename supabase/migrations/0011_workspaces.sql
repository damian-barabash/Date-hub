-- Воркспейсы: у каждого свои документы, наборы продаж, магазины, чаты, дашборды и финансовый реестр.
-- Текущий воркспейс приходит заголовком запроса `x-workspace` (фронт добавляет его к каждому запросу, edge — к своему клиенту).
-- public.cur_ws() возвращает его, только если у пользователя есть доступ (админ — ко всем), иначе null → пустые выборки.
-- Админ (profiles.is_admin) создаёт воркспейсы и выдаёт/забирает доступ; остальные видят только свои воркспейсы.

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
alter table public.profiles add column if not exists is_admin boolean not null default false;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.cur_ws() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare h text; w uuid; r text := coalesce(auth.role(), '');
begin
  begin h := nullif(current_setting('request.headers', true), '')::json->>'x-workspace'; exception when others then return null; end;
  if h is null or h !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  w := h::uuid;
  if not exists (select 1 from public.workspaces where id = w) then return null; end if;
  if r = 'service_role' then return w; end if;  -- edge functions сами проверяют доступ пользователя
  if r = 'authenticated' and (public.is_admin() or exists (select 1 from public.workspace_members m where m.workspace_id = w and m.user_id = auth.uid())) then return w; end if;
  return null;
end $$;
grant execute on function public.cur_ws(), public.is_admin() to authenticated, service_role, ai_reader;

-- ── два воркспейса: всё текущее → VYPOINT; продажи и магазины сети → CK COMPLEX
insert into public.workspaces (id, name) values
  ('b0e5a54e-625e-4b61-9798-aee7cb524192', 'VYPOINT'),
  ('41c7235e-fe77-4773-b574-96ab62b59848', 'CK COMPLEX')
on conflict (id) do nothing;
update public.profiles set is_admin = true where username = 'diamonochik';
insert into public.workspace_members (workspace_id, user_id)
  select 'b0e5a54e-625e-4b61-9798-aee7cb524192', p.id from public.profiles p join auth.users u on u.id = p.id
  on conflict do nothing;
insert into public.workspace_members (workspace_id, user_id)
  select '41c7235e-fe77-4773-b574-96ab62b59848', p.id from public.profiles p where p.is_admin
  on conflict do nothing;

-- ── workspace_id во всех таблицах данных
do $$ declare t text; begin
  foreach t in array array['documents','dashboards','datasets','locations','chats','reports','connectors',
                           'fin_invoices','fin_parties','fin_payments','fin_allocations','fin_checks','fin_meta','fin_order_values'] loop
    execute format('alter table public.%I add column if not exists workspace_id uuid references public.workspaces on delete cascade', t);
    execute format('update public.%I set workspace_id = %L where workspace_id is null', t,
      case when t = 'locations' then '41c7235e-fe77-4773-b574-96ab62b59848' else 'b0e5a54e-625e-4b61-9798-aee7cb524192' end);
    execute format('alter table public.%I alter column workspace_id set default public.cur_ws()', t);
    execute format('alter table public.%I alter column workspace_id set not null', t);
    execute format('create index if not exists %I on public.%I (workspace_id)', t || '_ws_idx', t);
  end loop;
end $$;

-- уникальность — внутри воркспейса
alter table public.documents drop constraint if exists documents_hash_key;
create unique index if not exists documents_ws_hash_key on public.documents (workspace_id, hash);
alter table public.dashboards drop constraint if exists dashboards_pkey;
alter table public.dashboards add primary key (workspace_id, category);
alter table public.locations drop constraint if exists locations_pkey;
alter table public.locations add primary key (workspace_id, code);
alter table public.fin_invoices drop constraint if exists fin_invoices_pkey;
alter table public.fin_invoices add primary key (workspace_id, key);
alter table public.fin_parties drop constraint if exists fin_parties_pkey;
alter table public.fin_parties add primary key (workspace_id, nip);
alter table public.fin_order_values drop constraint if exists fin_order_values_pkey;
alter table public.fin_order_values add primary key (workspace_id, order_no);
alter table public.fin_meta drop constraint if exists fin_meta_id_check;
alter table public.fin_meta drop constraint if exists fin_meta_pkey;
alter table public.fin_meta add primary key (workspace_id);
alter table public.fin_meta alter column id drop not null;
alter table public.fin_meta alter column id drop default;

-- таксономия вкладок — своя в каждом воркспейсе
update public.app_settings set key = 'taxonomy:b0e5a54e-625e-4b61-9798-aee7cb524192' where key = 'taxonomy';

-- ── RLS
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
drop policy if exists ws_read on public.workspaces;
create policy ws_read on public.workspaces for select to authenticated
  using (public.is_admin() or exists (select 1 from public.workspace_members m where m.workspace_id = id and m.user_id = auth.uid()));
drop policy if exists ws_admin on public.workspaces;
create policy ws_admin on public.workspaces for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists wm_read on public.workspace_members;
create policy wm_read on public.workspace_members for select to authenticated using (public.is_admin() or user_id = auth.uid());
drop policy if exists wm_admin on public.workspace_members;
create policy wm_admin on public.workspace_members for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.workspaces, public.workspace_members to authenticated;

-- профили: читать могут все вошедшие, менять — только сервер (иначе любой поставил бы себе is_admin)
drop policy if exists auth_all on public.profiles;
drop policy if exists auth_read on public.profiles;
create policy auth_read on public.profiles for select to authenticated using (true);

do $$ declare t text; begin
  -- таблицы, которые пользователь читает и меняет (в своём воркспейсе)
  foreach t in array array['documents','datasets','locations','reports','connectors'] loop
    execute format('drop policy if exists auth_all on public.%I', t);
    execute format('create policy auth_all on public.%I for all to authenticated using (workspace_id = (select public.cur_ws())) with check (workspace_id = (select public.cur_ws()))', t);
  end loop;
  -- только чтение
  foreach t in array array['dashboards','fin_invoices','fin_parties','fin_payments','fin_allocations','fin_checks','fin_meta','fin_order_values'] loop
    execute format('drop policy if exists auth_read on public.%I', t);
    execute format('create policy auth_read on public.%I for select to authenticated using (workspace_id = (select public.cur_ws()))', t);
  end loop;
  -- SQL ИИ (ai_reader): только текущий воркспейс
  foreach t in array array['documents','locations','fin_invoices','fin_parties','fin_payments','fin_allocations','fin_checks','fin_meta','fin_order_values'] loop
    execute format('drop policy if exists ai_read on public.%I', t);
    execute format('create policy ai_read on public.%I for select to ai_reader using (workspace_id = (select public.cur_ws()))', t);
  end loop;
end $$;
drop policy if exists auth_del on public.dashboards;
create policy auth_del on public.dashboards for delete to authenticated using (workspace_id = (select public.cur_ws()));
drop policy if exists auth_read on public.doc_chunks;
create policy auth_read on public.doc_chunks for select to authenticated
  using (exists (select 1 from public.documents d where d.id = doc_id and d.workspace_id = (select public.cur_ws())));
drop policy if exists own_chats on public.chats;
create policy own_chats on public.chats for all to authenticated
  using (created_by = auth.uid() and workspace_id = (select public.cur_ws())) with check (created_by = auth.uid() and workspace_id = (select public.cur_ws()));

-- ── документы
create or replace function public._ws() returns uuid
language plpgsql stable as $$
declare w uuid := public.cur_ws();
begin
  if w is null then raise exception 'no workspace access' using errcode = '42501'; end if;
  return w;
end $$;

create or replace function public.doc_upsert(p_doc jsonb, p_chunks text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; i int; w uuid := public._ws();
begin
  perform public._req();
  if coalesce(array_length(p_chunks, 1), 0) = 0 then raise exception 'empty document'; end if;
  select id into v_id from public.documents where hash = p_doc->>'hash' and workspace_id = w;
  if v_id is not null then
    delete from public.doc_chunks where doc_id = v_id;
    update public.documents set title = p_doc->>'title', path = coalesce(p_doc->>'path', ''), ext = p_doc->>'ext',
      size = (p_doc->>'size')::bigint, source = coalesce(p_doc->>'source', 'upload'), source_url = p_doc->>'source_url',
      pages = (p_doc->>'pages')::int, ocr = coalesce((p_doc->>'ocr')::boolean, false) where id = v_id;
  else
    insert into public.documents (workspace_id, title, path, ext, size, source, source_url, hash, pages, ocr)
    values (w, p_doc->>'title', coalesce(p_doc->>'path', ''), p_doc->>'ext', (p_doc->>'size')::bigint, coalesce(p_doc->>'source', 'upload'),
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

create or replace function public.doc_search(p_q text, p_limit int default 8, p_category text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q tsquery := public._doc_query(p_q); v_res jsonb; w uuid := public._ws();
begin
  perform public._req();
  if q is null then return '[]'; end if;
  select coalesce(jsonb_agg(t order by t.rank desc), '[]') into v_res from (
    select * from (
      select d.id, d.title, d.path, d.category, d.doc_type, d.doc_date, c.idx,
             ts_rank(c.tsv, q) + case when to_tsvector('simple', public._norm(d.title || ' ' || d.path)) @@ q then 0.3 else 0 end as rank,
             c.content, row_number() over (partition by d.id order by ts_rank(c.tsv, q) desc) rn
      from public.doc_chunks c join public.documents d on d.id = c.doc_id
      where d.workspace_id = w and c.tsv @@ q and (p_category is null or d.category = p_category)
    ) x where rn <= 2 order by rank desc limit least(p_limit, 30)
  ) t;
  return v_res;
end $$;

create or replace function public.doc_text(p_id uuid, p_from int default 0, p_count int default 6) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.documents where id = p_id and workspace_id = public._ws()) then
    jsonb_build_object('chunks', (select count(*) from public.doc_chunks where doc_id = p_id),
      'text', (select string_agg(content, E'\n' order by idx) from (select idx, content from public.doc_chunks where doc_id = p_id and idx >= p_from order by idx limit least(p_count, 40)) s))
  else jsonb_build_object('chunks', 0, 'text', null) end
$$;

create or replace function public.doc_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  with d as (select * from public.documents where workspace_id = public.cur_ws())
  select jsonb_build_object(
    'total', (select count(*) from d),
    'pending', (select count(*) from d where status = 'new'),
    'min_date', (select min(doc_date) from d), 'max_date', (select max(doc_date) from d),
    'cats', (select coalesce(jsonb_agg(t order by t.n desc), '[]') from (select coalesce(category, '—') category, count(*) n, sum(gross) gross from d group by 1) t),
    'types', (select coalesce(jsonb_agg(t order by t.n desc), '[]') from (select coalesce(doc_type, '—') doc_type, count(*) n from d group by 1 order by 2 desc limit 20) t))
$$;

-- ── наборы данных и магазины
create or replace function public._ds(p_id uuid) returns public.datasets
language plpgsql stable security definer set search_path = public as $$
declare d public.datasets;
begin
  select * into d from public.datasets where id = p_id and workspace_id = public.cur_ws();
  if not found then raise exception 'dataset % not found', p_id; end if;
  return d;
end $$;

create or replace function public.ds_create(
  p_name text, p_columns jsonb, p_meta jsonb default '{}', p_source text default 'file',
  p_roles jsonb default '{}', p_connector uuid default null
) returns uuid
language plpgsql security definer set search_path = public, ds as $$
declare
  v_id uuid := gen_random_uuid();
  v_tbl text := 'd_' || substr(replace(v_id::text, '-', ''), 1, 12);
  v_cols text := '';
  c jsonb; w uuid := public._ws();
begin
  perform public._req();
  for c in select * from jsonb_array_elements(p_columns) loop
    if (c->>'key') !~ '^[a-z_][a-z0-9_]{0,62}$' or (c->>'key') = '_rid' then
      raise exception 'bad column key %', c->>'key';
    end if;
    continue when c ? 'derived';
    v_cols := v_cols || format(', %I %s', c->>'key', public._pgtype(c->>'type'));
  end loop;
  execute format('create table ds.%I (_rid bigserial primary key %s)', v_tbl, v_cols);
  insert into public.datasets (id, workspace_id, name, source, table_name, columns, roles, meta, status, connector_id)
  values (v_id, w, p_name, p_source, v_tbl, p_columns, p_roles, p_meta, 'loading', p_connector);
  return v_id;
end $$;

create or replace function public.ds_finalize(p_id uuid) returns public.datasets
language plpgsql security definer set search_path = public, ds as $$
declare
  d public.datasets := public._ds(p_id);
  cols text[] := public._ds_cols(d);
  c jsonb; v_expr text; v_new jsonb := '[]'; v_stats jsonb; v_cnt bigint; r text; k text;
begin
  perform public._req();
  for c in select * from jsonb_array_elements(d.columns) loop
    if c ? 'derived' then
      v_expr := public._derived_expr(c->'derived', cols);
      if v_expr is null then raise exception 'derived: bad op'; end if;
      if not exists (select 1 from information_schema.columns
                     where table_schema = 'ds' and table_name = d.table_name and column_name = c->>'key') then
        execute format('alter table ds.%I add column %I %s generated always as (%s) stored',
          d.table_name, c->>'key', public._pgtype(c->>'type'), v_expr);
      end if;
    end if;
  end loop;
  for r, k in select key, value #>> '{}' from jsonb_each(d.roles) loop
    if r in ('manager', 'location', 'product', 'product_id', 'category', 'date', 'city', 'region') and k = any(cols) then
      execute format('create index if not exists %I on ds.%I (%I)', d.table_name || '_' || k || '_idx', d.table_name, k);
    end if;
  end loop;
  execute format('analyze ds.%I', d.table_name);
  execute format('select count(*) from ds.%I', d.table_name) into v_cnt;
  for c in select * from jsonb_array_elements(d.columns) loop
    if c->>'type' in ('number', 'integer') then
      execute format('select jsonb_build_object(''min'', min(%1$I), ''max'', max(%1$I), ''sum'', sum(%1$I), ''avg'', avg(%1$I), ''nulls'', count(*) filter (where %1$I is null)) from ds.%2$I',
        c->>'key', d.table_name) into v_stats;
    else
      execute format('select jsonb_build_object(''distinct'', (select count(distinct %1$I) from ds.%2$I), ''nulls'', (select count(*) from ds.%2$I where %1$I is null), ''top'', (select coalesce(jsonb_agg(jsonb_build_array(v, n)), ''[]'') from (select %1$I::text v, count(*) n from ds.%2$I where %1$I is not null group by 1 order by 2 desc limit 8) t))',
        c->>'key', d.table_name) into v_stats;
    end if;
    v_new := v_new || jsonb_build_array(c || jsonb_build_object('stats', v_stats));
  end loop;
  if d.roles ? 'location' and (d.roles->>'location') = any(cols) then
    execute format('insert into public.locations (workspace_id, code) select distinct %L::uuid, btrim(%I::text) from ds.%I where %I is not null and btrim(%I::text) <> '''' on conflict (workspace_id, code) do nothing',
      d.workspace_id, d.roles->>'location', d.table_name, d.roles->>'location', d.roles->>'location');
  end if;
  update public.datasets set columns = v_new, row_count = v_cnt, status = 'ready',
    version = version + 1, updated_at = now(),
    is_active = is_active or not exists (select 1 from public.datasets where is_active and id <> p_id and workspace_id = d.workspace_id)
  where id = p_id returning * into d;
  return d;
end $$;

create or replace function public.ds_set_active(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare w uuid := public._ws();
begin
  perform public._req();
  update public.datasets set is_active = (id = p_id) where workspace_id = w and (is_active or id = p_id);
end $$;

create or replace function public.ds_drop(p_id uuid) returns void
language plpgsql security definer set search_path = public, ds as $$
declare d public.datasets := public._ds(p_id);
begin
  perform public._req();
  execute format('drop table if exists ds.%I', d.table_name);
  delete from public.datasets where id = p_id;
  if not exists (select 1 from public.datasets where is_active and workspace_id = d.workspace_id) then
    update public.datasets set is_active = true
    where id = (select id from public.datasets where status = 'ready' and workspace_id = d.workspace_id order by created_at desc limit 1);
  end if;
  delete from public.ai_cache where true;
end $$;

create or replace function public.locations_import(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int; w uuid := public._ws();
begin
  perform public._req();
  insert into public.locations as l (workspace_id, code, name, label, city, street, postal, branch, kind, email, store_id, source, status, lat, lng, updated_at)
  select w, btrim(r->>'code'), nullif(btrim(r->>'name'), ''),
         concat_ws(', ', nullif(btrim(r->>'city'), ''), nullif(btrim(r->>'street'), '')),
         nullif(btrim(r->>'city'), ''), nullif(btrim(r->>'street'), ''), nullif(btrim(r->>'postal'), ''),
         nullif(btrim(r->>'branch'), ''), nullif(btrim(r->>'kind'), ''), nullif(btrim(r->>'email'), ''), nullif(btrim(r->>'store_id'), ''),
         'directory', 'pending', null, null, now()
  from jsonb_array_elements(p_rows) r
  where nullif(btrim(r->>'code'), '') is not null
  on conflict (workspace_id, code) do update set
    name = excluded.name, label = excluded.label, city = excluded.city, street = excluded.street, postal = excluded.postal,
    branch = excluded.branch, kind = excluded.kind, email = excluded.email, store_id = excluded.store_id, source = 'directory',
    status = case when l.status = 'manual' then 'manual'
                  when l.street is distinct from excluded.street or l.city is distinct from excluded.city or l.source <> 'directory' then 'pending'
                  else l.status end,
    lat = case when l.status = 'manual' then l.lat when l.street is distinct from excluded.street or l.city is distinct from excluded.city or l.source <> 'directory' then null else l.lat end,
    lng = case when l.status = 'manual' then l.lng when l.street is distinct from excluded.street or l.city is distinct from excluded.city or l.source <> 'directory' then null else l.lng end,
    updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ── финансовый реестр по воркспейсам
create or replace function public._with_ws(arr jsonb, w uuid) returns jsonb
language sql immutable as $$ select coalesce(jsonb_agg(e || jsonb_build_object('workspace_id', w)), '[]') from jsonb_array_elements(coalesce(arr, '[]')) e $$;

create or replace function public.fin_replace(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare w uuid := public._ws();
begin
  delete from public.fin_invoices where workspace_id = w;
  delete from public.fin_parties where workspace_id = w;
  delete from public.fin_payments where workspace_id = w;
  delete from public.fin_allocations where workspace_id = w;
  delete from public.fin_checks where workspace_id = w;
  delete from public.fin_order_values where workspace_id = w;
  insert into public.fin_invoices select * from jsonb_populate_recordset(null::public.fin_invoices, public._with_ws(p->'invoices', w));
  insert into public.fin_parties select * from jsonb_populate_recordset(null::public.fin_parties, public._with_ws(p->'parties', w));
  insert into public.fin_payments select * from jsonb_populate_recordset(null::public.fin_payments, public._with_ws(p->'payments', w));
  insert into public.fin_allocations select * from jsonb_populate_recordset(null::public.fin_allocations, public._with_ws(p->'allocations', w));
  insert into public.fin_checks (workspace_id, level, code, msg, key) select w, level, code, msg, key from jsonb_populate_recordset(null::public.fin_checks, p->'checks');
  insert into public.fin_order_values select * from jsonb_populate_recordset(null::public.fin_order_values, public._with_ws(p->'orders', w));
  insert into public.fin_meta (workspace_id, built_at, doc_count, docs_changed_at, sources, summary)
  values (w, now(), (p->>'doc_count')::int, (p->>'docs_changed_at')::timestamptz, p->'sources', p->'summary')
  on conflict (workspace_id) do update set built_at = excluded.built_at, doc_count = excluded.doc_count, docs_changed_at = excluded.docs_changed_at, sources = excluded.sources, summary = excluded.summary;
end $$;
revoke execute on function public.fin_replace(jsonb) from public, anon, authenticated;
grant execute on function public.fin_replace(jsonb) to service_role;

create or replace function public.fin_sources() returns table (id uuid, title text, path text, ext text, created_at timestamptz, chunks text[])
language sql stable security definer set search_path = public as $$
  select d.id, d.title, d.path, d.ext, d.created_at, t.chunks
  from public.documents d
  cross join lateral (select array_agg(content order by idx) chunks, string_agg(content, ' ') txt from public.doc_chunks where doc_id = d.id) t
  where d.workspace_id = public._ws()
    and (t.txt ~* '(faktura|korekta|nota ksi|potwierdzenie transakcji|przelew|zaliczk)'
     or (d.ext in ('xlsx','xls','xlsm','csv','ods') and t.txt ~* '(nr faktury|numer dokumentu|numer faktury)'))
$$;
revoke execute on function public.fin_sources() from public, anon, authenticated;
grant execute on function public.fin_sources() to service_role;

create or replace function public.fin_stale() returns boolean
language sql stable security definer set search_path = public as $$
  with w as (select public.cur_ws() id)
  select coalesce((select m.doc_count is distinct from (select count(*) from public.documents d, w where d.workspace_id = w.id)
                       or m.docs_changed_at is distinct from (select max(created_at) from public.documents d, w where d.workspace_id = w.id)
                   from public.fin_meta m, w where m.workspace_id = w.id),
                  (select count(*) > 0 from public.documents d, w where d.workspace_id = w.id))
$$;

-- ── SQL ИИ: таблицы продаж ds.d_* — только наборы текущего воркспейса
create or replace function ai.run(p_sql text, p_limit int) returns jsonb
language plpgsql security definer set search_path = ds, public as $$
declare v_sql text := btrim(regexp_replace(p_sql, ';\s*$', '')); v_res jsonb; t text; w uuid := public.cur_ws();
begin
  if w is null then raise exception 'no workspace'; end if;
  if v_sql !~* '^\s*(select|with)\s' then raise exception 'only SELECT allowed'; end if;
  if v_sql ~ ';' then raise exception 'single statement only'; end if;
  if v_sql ~* '\m(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|execute|vacuum|set|reset|lock|listen|notify|dblink)\M'
     or v_sql ~* '(pg_[a-z_]+\s*\(|lo_[a-z_]+\s*\(|set_config|current_setting|query_to_xml|generate_series\s*\(\s*\d+\s*,\s*\d{7,})' then
    raise exception 'forbidden keyword or function';
  end if;
  for t in select distinct lower(m[1]) from regexp_matches(v_sql, '\m(d_[0-9a-f]{12})\M', 'gi') m loop
    if not exists (select 1 from public.datasets where table_name = t and workspace_id = w) then raise exception 'unknown table %', t; end if;
  end loop;
  execute format('select coalesce(jsonb_agg(t), ''[]'') from (select * from (%s) q limit %s) t', v_sql, least(p_limit, 2000))
    into v_res;
  return v_res;
end $$;
alter function ai.run(text, int) owner to ai_reader;
grant select on public.datasets to ai_reader;
drop policy if exists ai_read on public.datasets;
create policy ai_read on public.datasets for select to ai_reader using (workspace_id = (select public.cur_ws()));

-- ── управление воркспейсами (только админ; удаление воркспейса стирает и его таблицы ds.*)
create or replace function public.ws_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public, ds as $$
declare t text;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then raise exception 'admin only' using errcode = '42501'; end if;
  for t in select table_name from public.datasets where workspace_id = p_id loop execute format('drop table if exists ds.%I', t); end loop;
  delete from public.workspaces where id = p_id;
end $$;
revoke execute on function public.ws_delete(uuid) from public, anon, authenticated;
grant execute on function public.ws_delete(uuid) to service_role; -- вызывает edge `users` после проверки админа
