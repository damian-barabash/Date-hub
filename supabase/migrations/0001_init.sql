-- AI DATE HUB — core schema
-- Каждый источник (Excel, CSV, REST/POS, внешняя БД) превращается в таблицу ds.d_<id>,
-- описанную в public.datasets (колонки, роли, метаданные). Всё остальное работает поверх каталога.

create extension if not exists pgcrypto;
create schema if not exists ds;
revoke all on schema ds from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'ai_reader') then
    create role ai_reader nologin;
  end if;
end $$;
grant usage on schema ds to ai_reader;
alter default privileges in schema ds grant select on tables to ai_reader;

-- ───────────────────────── tables ─────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null,
  display_name text,
  lang text not null default 'pl',
  created_at timestamptz not null default now()
);

create table if not exists public.connectors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null,                       -- rest | file_url | postgres | mysql
  config jsonb not null default '{}',       -- без секретов
  schedule_minutes int,                     -- null = только вручную
  mode text not null default 'replace',     -- replace | append
  dataset_id uuid,
  last_sync_at timestamptz,
  last_status text,
  last_error text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- секреты коннекторов: RLS без политик → читает только service_role (edge functions)
create table if not exists public.connector_secrets (
  connector_id uuid primary key references public.connectors on delete cascade,
  secret jsonb not null default '{}'
);

create table if not exists public.datasets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source text not null default 'file',
  table_name text not null unique,
  columns jsonb not null default '[]',      -- [{key,label,type,role?,derived?,stats?}]
  roles jsonb not null default '{}',        -- {role: column_key}
  meta jsonb not null default '{}',         -- period, file, notes, card
  row_count bigint not null default 0,
  status text not null default 'loading',
  is_active boolean not null default false,
  version int not null default 1,
  connector_id uuid references public.connectors on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.connectors
  drop constraint if exists connectors_dataset_fk,
  add constraint connectors_dataset_fk foreign key (dataset_id) references public.datasets on delete set null;

create table if not exists public.locations (
  code text primary key,
  label text,
  city text,
  street text,
  postal text,
  region text,
  lat double precision,
  lng double precision,
  status text not null default 'pending',   -- pending | ok | approx | failed | manual
  note text,
  updated_at timestamptz not null default now()
);

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Nowa rozmowa',
  dataset_id uuid references public.datasets on delete set null,
  summary text,
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats on delete cascade,
  role text not null,                        -- user | assistant
  content jsonb not null,
  usage jsonb,
  created_at timestamptz not null default now()
);
create index if not exists messages_chat_idx on public.messages (chat_id, created_at);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content jsonb not null,
  dataset_id uuid references public.datasets on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_cache (
  hash text primary key,
  answer jsonb not null,
  hits int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_usage (
  id bigserial primary key,
  user_id uuid,
  model text,
  prompt_tokens int default 0,
  cache_hit_tokens int default 0,
  completion_tokens int default 0,
  cached_answer boolean default false,
  created_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('ai', '{"model":"deepseek-chat","temperature":0.3,"history_turns":6,"rows_to_model":40,"rows_to_client":500,"cache":true,"cache_ttl_hours":24,"max_rounds":3}'),
  ('ui', '{"animations":true,"currency":"PLN","vat":0.23}')
on conflict (key) do nothing;

-- ───────────────────────── RLS ─────────────────────────
alter table public.profiles enable row level security;
alter table public.connectors enable row level security;
alter table public.connector_secrets enable row level security;
alter table public.datasets enable row level security;
alter table public.locations enable row level security;
alter table public.chats enable row level security;
alter table public.messages enable row level security;
alter table public.reports enable row level security;
alter table public.app_settings enable row level security;
alter table public.ai_cache enable row level security;
alter table public.ai_usage enable row level security;

do $$
declare t text;
begin
  -- общие таблицы: любой вошедший пользователь (ролей пока нет)
  foreach t in array array['profiles','connectors','datasets','locations','reports','app_settings'] loop
    execute format('drop policy if exists auth_all on public.%I', t);
    execute format('create policy auth_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
  foreach t in array array['ai_usage','ai_cache'] loop
    execute format('drop policy if exists auth_read on public.%I', t);
    execute format('create policy auth_read on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

drop policy if exists own_chats on public.chats;
create policy own_chats on public.chats for all to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
drop policy if exists own_messages on public.messages;
create policy own_messages on public.messages for all to authenticated
  using (exists (select 1 from public.chats c where c.id = chat_id and c.created_by = auth.uid()))
  with check (exists (select 1 from public.chats c where c.id = chat_id and c.created_by = auth.uid()));

grant select on public.locations to ai_reader;

-- ───────────────────────── helpers ─────────────────────────
create or replace function public._req() returns void
language plpgsql stable as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'service_role') then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
end $$;

create or replace function public._ds(p_id uuid) returns public.datasets
language plpgsql stable security definer set search_path = public as $$
declare d public.datasets;
begin
  select * into d from public.datasets where id = p_id;
  if not found then raise exception 'dataset % not found', p_id; end if;
  return d;
end $$;

create or replace function public._ds_cols(d public.datasets) returns text[]
language sql immutable as $$
  select coalesce(array_agg(x->>'key'), '{}') from jsonb_array_elements(d.columns) x
$$;

create or replace function public._pgtype(t text) returns text
language sql immutable as $$
  select case t when 'number' then 'double precision' when 'integer' then 'bigint'
    when 'date' then 'date' when 'datetime' then 'timestamptz' when 'boolean' then 'boolean' else 'text' end
$$;

-- ───────────────────────── dataset lifecycle ─────────────────────────
create or replace function public.ds_create(
  p_name text, p_columns jsonb, p_meta jsonb default '{}', p_source text default 'file',
  p_roles jsonb default '{}', p_connector uuid default null
) returns uuid
language plpgsql security definer set search_path = public, ds as $$
declare
  v_id uuid := gen_random_uuid();
  v_tbl text := 'd_' || substr(replace(v_id::text, '-', ''), 1, 12);
  v_cols text := '';
  c jsonb;
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
  insert into public.datasets (id, name, source, table_name, columns, roles, meta, status, connector_id)
  values (v_id, p_name, p_source, v_tbl, p_columns, p_roles, p_meta, 'loading', p_connector);
  return v_id;
end $$;

create or replace function public.ds_insert(p_id uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public, ds as $$
declare d public.datasets := public._ds(p_id); v_cols text; n int;
begin
  perform public._req();
  select string_agg(format('%I', x->>'key'), ', ') into v_cols
    from jsonb_array_elements(d.columns) x where not (x ? 'derived');
  execute format('insert into ds.%I (%s) select %s from jsonb_populate_recordset(null::ds.%I, $1)',
    d.table_name, v_cols, v_cols, d.table_name) using p_rows;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.ds_truncate(p_id uuid) returns void
language plpgsql security definer set search_path = public, ds as $$
declare d public.datasets := public._ds(p_id);
begin
  perform public._req();
  execute format('truncate ds.%I restart identity', d.table_name);
end $$;

-- выражение для производной колонки (только из безопасного набора операций)
create or replace function public._derived_expr(dv jsonb, cols text[]) returns text
language plpgsql immutable as $$
declare a text := dv->>'a'; b text := dv->>'b';
begin
  if a is null or not a = any(cols) then raise exception 'derived: bad column %', a; end if;
  if b is not null and not b = any(cols) then raise exception 'derived: bad column %', b; end if;
  return case dv->>'op'
    when 'mul' then format('(%I * %I)', a, b)
    when 'sub' then format('(%I - %I)', a, b)
    when 'add' then format('(%I + %I)', a, b)
    when 'div' then format('(%I / nullif(%I, 0))', a, b)
    when 'first_word' then format('initcap(lower(nullif(split_part(btrim(%I), '' '', 1), '''')))', a)
    when 'prefix' then format('upper(nullif(split_part(btrim(%I), %L, 1), ''''))', a, coalesce(dv->>'sep', '-'))
    else null end;
end $$;

-- после загрузки: производные колонки, индексы, профиль колонок, карточка для ИИ, локации
create or replace function public.ds_finalize(p_id uuid) returns public.datasets
language plpgsql security definer set search_path = public, ds as $$
declare
  d public.datasets := public._ds(p_id);
  cols text[] := public._ds_cols(d);
  c jsonb; v_expr text; v_new jsonb := '[]'; v_stats jsonb; v_cnt bigint; r text; k text;
begin
  perform public._req();
  -- производные колонки (generated stored)
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

  -- индексы на ключевые измерения
  for r, k in select key, value #>> '{}' from jsonb_each(d.roles) loop
    if r in ('manager', 'location', 'product', 'product_id', 'category', 'date', 'city', 'region') and k = any(cols) then
      execute format('create index if not exists %I on ds.%I (%I)', d.table_name || '_' || k || '_idx', d.table_name, k);
    end if;
  end loop;
  execute format('analyze ds.%I', d.table_name);
  execute format('select count(*) from ds.%I', d.table_name) into v_cnt;

  -- профиль каждой колонки
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

  -- новые коды локаций → очередь геокодирования
  if d.roles ? 'location' and (d.roles->>'location') = any(cols) then
    execute format('insert into public.locations (code) select distinct btrim(%I::text) from ds.%I where %I is not null and btrim(%I::text) <> '''' on conflict (code) do nothing',
      d.roles->>'location', d.table_name, d.roles->>'location', d.roles->>'location');
  end if;

  update public.datasets set columns = v_new, row_count = v_cnt, status = 'ready',
    version = version + 1, updated_at = now(),
    is_active = is_active or not exists (select 1 from public.datasets where is_active and id <> p_id)
  where id = p_id returning * into d;
  return d;
end $$;

create or replace function public.ds_set_active(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._req();
  update public.datasets set is_active = (id = p_id) where is_active or id = p_id;
end $$;

create or replace function public.ds_drop(p_id uuid) returns void
language plpgsql security definer set search_path = public, ds as $$
declare d public.datasets := public._ds(p_id);
begin
  perform public._req();
  execute format('drop table if exists ds.%I', d.table_name);
  delete from public.datasets where id = p_id;
  if not exists (select 1 from public.datasets where is_active) then
    update public.datasets set is_active = true
    where id = (select id from public.datasets where status = 'ready' order by created_at desc limit 1);
  end if;
  delete from public.ai_cache where true;
end $$;

-- ───────────────────────── query layer ─────────────────────────
-- where-условие из [{col, op, val}]
create or replace function public._ds_where(p_filters jsonb, cols text[]) returns text
language plpgsql immutable as $$
declare f jsonb; parts text[] := '{}'; c text; v jsonb;
begin
  for f in select * from jsonb_array_elements(coalesce(p_filters, '[]')) loop
    c := f->>'col'; v := f->'val';
    if not c = any(cols) then raise exception 'filter: unknown column %', c; end if;
    parts := parts || case f->>'op'
      when 'eq' then format('%I::text = %L', c, v #>> '{}')
      when 'neq' then format('%I::text is distinct from %L', c, v #>> '{}')
      when 'in' then format('%I::text = any(%L::text[])', c, (select array_agg(x) from jsonb_array_elements_text(v) x))
      when 'gt' then format('%I > %L', c, v #>> '{}')
      when 'gte' then format('%I >= %L', c, v #>> '{}')
      when 'lt' then format('%I < %L', c, v #>> '{}')
      when 'lte' then format('%I <= %L', c, v #>> '{}')
      when 'like' then format('%I::text ilike %L', c, '%' || (v #>> '{}') || '%')
      when 'null' then format('%I is null', c)
      when 'notnull' then format('%I is not null', c)
      else null end;
  end loop;
  if array_length(parts, 1) is null then return ''; end if;
  return 'where ' || array_to_string(parts, ' and ');
end $$;

-- универсальная агрегация для дашбордов:
-- {group:[col], metrics:[{fn,col,w?,val?,as}], filters:[...], order:[{by,dir}], limit}
create or replace function public.ds_agg(p_id uuid, p_spec jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, ds as $$
declare
  d public.datasets := public._ds(p_id);
  cols text[] := public._ds_cols(d);
  v_sel text[] := '{}'; v_grp text[] := '{}'; v_alias text[] := '{}'; v_ord text[] := '{}';
  g text; m jsonb; o jsonb; v_expr text; v_as text; v_col text; v_w text; v_res jsonb;
  v_lim int := least(coalesce((p_spec->>'limit')::int, 1000), 5000);
begin
  perform public._req();
  for g in select jsonb_array_elements_text(coalesce(p_spec->'group', '[]')) loop
    if not g = any(cols) then raise exception 'group: unknown column %', g; end if;
    v_sel := v_sel || format('%I', g); v_grp := v_grp || format('%I', g); v_alias := v_alias || g;
  end loop;
  for m in select * from jsonb_array_elements(coalesce(p_spec->'metrics', '[]')) loop
    v_col := m->>'col'; v_w := m->>'w';
    if v_col is not null and not v_col = any(cols) then raise exception 'metric: unknown column %', v_col; end if;
    if v_w is not null and not v_w = any(cols) then raise exception 'metric: unknown column %', v_w; end if;
    v_expr := case m->>'fn'
      when 'sum' then format('sum(%I)', v_col)
      when 'avg' then format('avg(%I)', v_col)
      when 'min' then format('min(%I)', v_col)
      when 'max' then format('max(%I)', v_col)
      when 'median' then format('percentile_cont(0.5) within group (order by %I)', v_col)
      when 'count' then 'count(*)'
      when 'count_distinct' then format('count(distinct %I)', v_col)
      when 'wavg' then format('sum(%I * %I) / nullif(sum(%I), 0)', v_col, v_w, v_w)
      when 'ratio' then format('sum(%I) / nullif(sum(%I), 0)', v_col, v_w)
      when 'count_lt' then format('count(*) filter (where %I < %s)', v_col, (m->>'val')::double precision)
      when 'count_lte' then format('count(*) filter (where %I <= %s)', v_col, (m->>'val')::double precision)
      when 'count_gt' then format('count(*) filter (where %I > %s)', v_col, (m->>'val')::double precision)
      when 'mode' then format('mode() within group (order by %I)', v_col)
      else null end;
    if v_expr is null then raise exception 'metric: bad fn %', m->>'fn'; end if;
    v_as := coalesce(m->>'as', (m->>'fn') || '_' || coalesce(v_col, 'all'));
    if v_as !~ '^[a-zA-Z_][a-zA-Z0-9_]{0,62}$' then raise exception 'bad alias'; end if;
    v_sel := v_sel || format('%s as %I', v_expr, v_as); v_alias := v_alias || v_as;
  end loop;
  if array_length(v_sel, 1) is null then raise exception 'empty select'; end if;
  for o in select * from jsonb_array_elements(coalesce(p_spec->'order', '[]')) loop
    if not (o->>'by') = any(v_alias) then raise exception 'order: unknown %', o->>'by'; end if;
    v_ord := v_ord || format('%I %s nulls last', o->>'by', case when lower(o->>'dir') = 'asc' then 'asc' else 'desc' end);
  end loop;
  execute format('select coalesce(jsonb_agg(t), ''[]'') from (select %s from ds.%I %s %s %s limit %s) t',
    array_to_string(v_sel, ', '), d.table_name, public._ds_where(p_spec->'filters', cols),
    case when array_length(v_grp, 1) > 0 then 'group by ' || array_to_string(v_grp, ', ') else '' end,
    case when array_length(v_ord, 1) > 0 then 'order by ' || array_to_string(v_ord, ', ') else '' end,
    v_lim) into v_res;
  return v_res;
end $$;

-- гистограмма: явные границы или автоматически по 2–98 перцентилю
create or replace function public.ds_hist(p_id uuid, p_col text, p_edges double precision[] default null,
  p_buckets int default 12, p_filters jsonb default '[]') returns jsonb
language plpgsql stable security definer set search_path = public, ds as $$
declare
  d public.datasets := public._ds(p_id); cols text[] := public._ds_cols(d);
  lo double precision; hi double precision; w text := public._ds_where(p_filters, cols); v_res jsonb;
begin
  perform public._req();
  if not p_col = any(cols) then raise exception 'unknown column %', p_col; end if;
  if p_edges is null then
    execute format('select percentile_cont(0.02) within group (order by %1$I), percentile_cont(0.98) within group (order by %1$I) from ds.%2$I %3$s',
      p_col, d.table_name, w) into lo, hi;
    if lo is null or hi is null or lo = hi then return '[]'; end if;
    select array_agg(lo + (hi - lo) * i / p_buckets) into p_edges from generate_series(0, p_buckets) i;
  end if;
  execute format($q$
    with e as (select $1 as edges), b as (
      select width_bucket(%1$I, (select edges from e)) as bk, count(*) n from ds.%2$I %3$s %4$s %1$I is not null group by 1)
    select coalesce(jsonb_agg(jsonb_build_object(
      'lo', case when bk = 0 then null else (select edges from e)[bk] end,
      'hi', case when bk >= array_length((select edges from e), 1) then null else (select edges from e)[bk + 1] end,
      'n', n) order by bk), '[]') from b $q$,
    p_col, d.table_name, w, case when w = '' then 'where' else 'and' end) using p_edges into v_res;
  return v_res;
end $$;

-- постраничные строки для таблиц
create or replace function public.ds_rows(p_id uuid, p_filters jsonb default '[]', p_order jsonb default '[]',
  p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public, ds as $$
declare
  d public.datasets := public._ds(p_id); cols text[] := public._ds_cols(d);
  w text := public._ds_where(p_filters, cols); o jsonb; v_ord text[] := '{}'; v_rows jsonb; v_total bigint;
begin
  perform public._req();
  for o in select * from jsonb_array_elements(coalesce(p_order, '[]')) loop
    if not (o->>'by') = any(cols) then raise exception 'order: unknown %', o->>'by'; end if;
    v_ord := v_ord || format('%I %s nulls last', o->>'by', case when lower(o->>'dir') = 'asc' then 'asc' else 'desc' end);
  end loop;
  execute format('select count(*) from ds.%I %s', d.table_name, w) into v_total;
  execute format('select coalesce(jsonb_agg(to_jsonb(t) - ''_rid''), ''[]'') from (select * from ds.%I %s order by %s limit %s offset %s) t',
    d.table_name, w, case when array_length(v_ord, 1) > 0 then array_to_string(v_ord, ', ') else '_rid' end,
    least(p_limit, 1000), greatest(p_offset, 0)) into v_rows;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end $$;

-- SQL от ИИ: только SELECT, исполняется под ролью ai_reader (прав на запись нет), таймаут, лимит строк.
-- ai.run принадлежит ai_reader; public.ai_sql — обёртка, доступна только service_role (edge function).
create schema if not exists ai;
revoke all on schema ai from public, anon, authenticated;
grant ai_reader to postgres;
grant usage, create on schema ai to ai_reader;
grant usage on schema public to ai_reader;

create or replace function ai.run(p_sql text, p_limit int) returns jsonb
language plpgsql security definer set search_path = ds, public set statement_timeout = '8s' as $$
declare v_sql text := btrim(regexp_replace(p_sql, ';\s*$', '')); v_res jsonb;
begin
  if v_sql !~* '^\s*(select|with)\s' then raise exception 'only SELECT allowed'; end if;
  if v_sql ~ ';' then raise exception 'single statement only'; end if;
  if v_sql ~* '\m(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|do|execute|vacuum|set|reset|lock|listen|notify|pg_read|pg_ls|lo_|dblink)\M' then
    raise exception 'forbidden keyword';
  end if;
  execute format('select coalesce(jsonb_agg(t), ''[]'') from (select * from (%s) q limit %s) t', v_sql, least(p_limit, 2000))
    into v_res;
  return v_res;
end $$;
alter function ai.run(text, int) owner to ai_reader;
revoke execute on function ai.run(text, int) from public;
grant execute on function ai.run(text, int) to postgres;

create or replace function public.ai_sql(p_sql text, p_limit int default 500) returns jsonb
language sql security definer set search_path = public as $$ select ai.run(p_sql, p_limit) $$;

-- ───────────────────────── grants ─────────────────────────
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.ds_create(text, jsonb, jsonb, text, jsonb, uuid), public.ds_insert(uuid, jsonb),
  public.ds_truncate(uuid), public.ds_finalize(uuid), public.ds_set_active(uuid), public.ds_drop(uuid),
  public.ds_agg(uuid, jsonb), public.ds_hist(uuid, text, double precision[], int, jsonb),
  public.ds_rows(uuid, jsonb, jsonb, int, int)
  to authenticated, service_role;
revoke execute on function public.ai_sql(text, int) from authenticated;
grant execute on function public.ai_sql(text, int) to service_role;
grant execute on function public._req(), public._ds(uuid), public._ds_cols(public.datasets), public._pgtype(text),
  public._derived_expr(jsonb, text[]), public._ds_where(jsonb, text[]) to authenticated, service_role, ai_reader;
