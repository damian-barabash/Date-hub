-- Справочник точек продаж (например «CK_Sklepy_import»): точные адреса, отделение, тип, e-mail.
alter table public.locations
  add column if not exists name text,
  add column if not exists branch text,
  add column if not exists kind text,
  add column if not exists email text,
  add column if not exists store_id text,
  add column if not exists source text not null default 'auto';  -- auto (код разобран ИИ) | directory | manual

-- upsert строк справочника: [{code, name, city, street, postal, branch, kind, email, store_id}]
create or replace function public.locations_import(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public._req();
  insert into public.locations as l (code, name, label, city, street, postal, branch, kind, email, store_id, source, status, lat, lng, updated_at)
  select btrim(r->>'code'), nullif(btrim(r->>'name'), ''),
         concat_ws(', ', nullif(btrim(r->>'city'), ''), nullif(btrim(r->>'street'), '')),
         nullif(btrim(r->>'city'), ''), nullif(btrim(r->>'street'), ''), nullif(btrim(r->>'postal'), ''),
         nullif(btrim(r->>'branch'), ''), nullif(btrim(r->>'kind'), ''), nullif(btrim(r->>'email'), ''), nullif(btrim(r->>'store_id'), ''),
         'directory', 'pending', null, null, now()
  from jsonb_array_elements(p_rows) r
  where nullif(btrim(r->>'code'), '') is not null
  on conflict (code) do update set
    name = excluded.name, label = excluded.label, city = excluded.city, street = excluded.street, postal = excluded.postal,
    branch = excluded.branch, kind = excluded.kind, email = excluded.email, store_id = excluded.store_id, source = 'directory',
    -- адрес изменился → геокодируем заново (ручные координаты не трогаем)
    status = case when l.status = 'manual' then 'manual'
                  when l.street is distinct from excluded.street or l.city is distinct from excluded.city or l.source <> 'directory' then 'pending'
                  else l.status end,
    lat = case when l.status = 'manual' then l.lat when l.street is distinct from excluded.street or l.city is distinct from excluded.city or l.source <> 'directory' then null else l.lat end,
    lng = case when l.status = 'manual' then l.lng when l.street is distinct from excluded.street or l.city is distinct from excluded.city or l.source <> 'directory' then null else l.lng end,
    updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.locations_import(jsonb) from public, anon;
grant execute on function public.locations_import(jsonb) to authenticated, service_role;
