-- Финансовый реестр: «один счёт = одна строка», собирается движком src/lib/finance/engine.ts из ТЕКСТА документов
-- (счета, реестры фирмы в xlsx, подтверждения банка, ноты). Пересборка — edge `docs` action=finance (и автоматически в `ai`, если документы изменились).
-- Пишет только service_role через fin_replace; читают пользователи и SQL ИИ (роль ai_reader).

create table if not exists public.fin_invoices (
  key text primary key,                 -- NIP продавца # канонический номер
  seller_nip text, seller text, seller_code text, buyer_nip text, buyer text,
  number text not null, kind text not null,          -- faktura | zaliczkowa | rozliczeniowa | korekta
  issue_date date, sale_date date, due_date date,
  net numeric(14,2), vat numeric(14,2), gross numeric(14,2),   -- как на документе
  value_net numeric(14,2), value_gross numeric(14,2),          -- вклад в общую сумму без двойного счёта
  advance_used numeric(14,2),           -- сколько аванса покрыл/вычел этот счёт
  advance_left numeric(14,2),           -- для авансов: сколько ещё не рассчитано
  paid numeric(14,2), open numeric(14,2), paid_date date,
  pay_status text,                      -- zapłacona | częściowo | niezapłacona | rozliczona zaliczką | skorygowana | brak danych
  pay_source text, pay_asof date,       -- откуда статус и на какую дату
  counted boolean not null default true, in_registry boolean not null default false,
  order_no text, subject text, project text, stage text, settles text[], corrects text,
  doc_ids uuid[], doc_titles text[], main_doc uuid,
  observations jsonb not null default '[]', issues text[] not null default '{}'
);
create index if not exists fin_invoices_date_idx on public.fin_invoices (issue_date);
create index if not exists fin_invoices_order_idx on public.fin_invoices (order_no);

create table if not exists public.fin_parties (nip text primary key, code text, name text, role text, aliases text[]);
create table if not exists public.fin_payments (doc_id uuid primary key, title text, date date, amount numeric(14,2), payer text, payee text, refs text[], matched text);
create table if not exists public.fin_allocations (doc_id uuid primary key, title text, number text, date date, seller_nip text, amount numeric(14,2), from_order text, to_order text, text text);
create table if not exists public.fin_checks (id bigserial primary key, level text, code text, msg text, key text);
create table if not exists public.fin_meta (id int primary key default 1 check (id = 1), built_at timestamptz, doc_count int, docs_changed_at timestamptz, sources jsonb, summary jsonb);

do $$ declare t text; begin
  foreach t in array array['fin_invoices','fin_parties','fin_payments','fin_allocations','fin_checks','fin_meta'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists auth_read on public.%I', t);
    execute format('create policy auth_read on public.%I for select to authenticated using (true)', t);
    execute format('drop policy if exists ai_read on public.%I', t);
    execute format('create policy ai_read on public.%I for select to ai_reader using (true)', t);
    execute format('grant select on public.%I to authenticated, ai_reader', t);
  end loop;
end $$;

-- атомарная замена реестра целиком (одна транзакция)
create or replace function public.fin_replace(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.fin_invoices where true;
  delete from public.fin_parties where true;
  delete from public.fin_payments where true;
  delete from public.fin_allocations where true;
  delete from public.fin_checks where true;
  insert into public.fin_invoices select * from jsonb_populate_recordset(null::public.fin_invoices, p->'invoices');
  insert into public.fin_parties select * from jsonb_populate_recordset(null::public.fin_parties, p->'parties');
  insert into public.fin_payments select * from jsonb_populate_recordset(null::public.fin_payments, p->'payments');
  insert into public.fin_allocations select * from jsonb_populate_recordset(null::public.fin_allocations, p->'allocations');
  insert into public.fin_checks (level, code, msg, key) select level, code, msg, key from jsonb_populate_recordset(null::public.fin_checks, p->'checks');
  insert into public.fin_meta (id, built_at, doc_count, docs_changed_at, sources, summary)
  values (1, now(), (p->>'doc_count')::int, (p->>'docs_changed_at')::timestamptz, p->'sources', p->'summary')
  on conflict (id) do update set built_at = excluded.built_at, doc_count = excluded.doc_count, docs_changed_at = excluded.docs_changed_at, sources = excluded.sources, summary = excluded.summary;
end $$;
revoke execute on function public.fin_replace(jsonb) from public, anon, authenticated;
grant execute on function public.fin_replace(jsonb) to service_role;

-- тексты документов, из которых строится реестр (счета, ноты, подтверждения, реестры xlsx)
create or replace function public.fin_sources() returns table (id uuid, title text, path text, ext text, created_at timestamptz, chunks text[])
language sql stable security definer set search_path = public as $$
  select d.id, d.title, d.path, d.ext, d.created_at, t.chunks
  from public.documents d
  cross join lateral (select array_agg(content order by idx) chunks, string_agg(content, ' ') txt from public.doc_chunks where doc_id = d.id) t
  where t.txt ~* '(faktura|korekta|nota ksi|potwierdzenie transakcji|przelew|zaliczk)'
     or (d.ext in ('xlsx','xls','xlsm','csv','ods') and t.txt ~* '(nr faktury|numer dokumentu|numer faktury)')
$$;
revoke execute on function public.fin_sources() from public, anon, authenticated;
grant execute on function public.fin_sources() to service_role;

-- состояние документов: изменилось ли что-то после последней сборки
create or replace function public.fin_stale() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select m.doc_count is distinct from (select count(*) from public.documents)
                       or m.docs_changed_at is distinct from (select max(created_at) from public.documents)
                   from public.fin_meta m where m.id = 1), true)
$$;
grant execute on function public.fin_stale() to authenticated, service_role;

-- представления для ИИ и экранов
create or replace view public.fin_receivables with (security_invoker = true) as
  select seller_code, seller, number, kind, issue_date, due_date, gross, paid, open, pay_status, pay_source, pay_asof,
         greatest(0, current_date - due_date) as days_overdue, order_no, subject, doc_titles[1] as dokument
  from public.fin_invoices
  where counted and pay_status in ('niezapłacona', 'częściowo') and open > 0;

create or replace view public.fin_orders with (security_invoker = true) as
  select order_no, min(seller_code) as seller_code, string_agg(distinct seller_code, ', ') as sellers,
         count(*) filter (where kind <> 'korekta') as invoices,
         sum(value_net) as value_net, sum(value_gross) as value_gross,
         sum(open) filter (where pay_status in ('niezapłacona','częściowo')) as open,
         sum(advance_left) filter (where kind = 'zaliczkowa') as advance_left,
         min(issue_date) as first_invoice, max(issue_date) as last_invoice,
         (array_agg(subject order by issue_date) filter (where subject is not null))[1] as subject
  from public.fin_invoices where counted and order_no is not null group by order_no;
grant select on public.fin_receivables, public.fin_orders to authenticated, ai_reader;

-- старое представление invoices (по полям ИИ) больше не источник сумм: оставляем совместимость поверх реестра
drop view if exists public.invoices;
create view public.invoices with (security_invoker = true) as
  select main_doc as id, doc_titles[1] as title, seller_code as party, seller as counterparty, number, kind as doc_type, issue_date as doc_date,
         value_net as net, null::numeric as vat, value_gross as gross, 'PLN'::text as currency
  from public.fin_invoices where counted;
grant select on public.invoices to authenticated, ai_reader;

-- SQL ИИ: «do» убран из запрещённых слов — модель пишет алиасы «AS do» (дата «do»), а DO-блок внутри SELECT невозможен
create or replace function ai.run(p_sql text, p_limit int) returns jsonb
language plpgsql security definer set search_path = ds, public as $$
declare v_sql text := btrim(regexp_replace(p_sql, ';\s*$', '')); v_res jsonb;
begin
  if v_sql !~* '^\s*(select|with)\s' then raise exception 'only SELECT allowed'; end if;
  if v_sql ~ ';' then raise exception 'single statement only'; end if;
  if v_sql ~* '\m(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|execute|vacuum|set|reset|lock|listen|notify|dblink)\M'
     or v_sql ~* '(pg_[a-z_]+\s*\(|lo_[a-z_]+\s*\(|set_config|current_setting|query_to_xml|generate_series\s*\(\s*\d+\s*,\s*\d{7,})' then
    raise exception 'forbidden keyword or function';
  end if;
  execute format('select coalesce(jsonb_agg(t), ''[]'') from (select * from (%s) q limit %s) t', v_sql, least(p_limit, 2000))
    into v_res;
  return v_res;
end $$;
alter function ai.run(text, int) owner to ai_reader;
