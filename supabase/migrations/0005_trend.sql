-- Тренд по времени внутри одного набора (если есть колонка-дата): период → стандартные метрики по ролям.
create or replace function public.ds_trend(p_id uuid, p_unit text default 'month') returns jsonb
language plpgsql stable security definer set search_path = public, ds as $$
declare
  d public.datasets := public._ds(p_id);
  cols text[] := public._ds_cols(d);
  r jsonb := d.roles;
  v_date text := r->>'date';
  v_rev text := coalesce(r->>'net', r->>'gross');
  v_fmt text; v_sel text[] := '{}'; v_res jsonb; v_type text;
begin
  perform public._req();
  if v_date is null or not v_date = any(cols) then return '[]'; end if;
  select x->>'type' into v_type from jsonb_array_elements(d.columns) x where x->>'key' = v_date;
  if v_type not in ('date', 'datetime') then return '[]'; end if;
  v_fmt := case p_unit when 'day' then 'YYYY-MM-DD' when 'week' then 'IYYY-"W"IW' when 'month' then 'YYYY-MM'
                       when 'quarter' then 'YYYY-"Q"Q' when 'year' then 'YYYY' else null end;
  if v_fmt is null then raise exception 'bad unit %', p_unit; end if;
  if v_rev is not null and v_rev = any(cols) then v_sel := v_sel || format('sum(%I) as revenue', v_rev); end if;
  if r ? 'gross' and r ? 'net' and (r->>'gross') = any(cols) then v_sel := v_sel || format('sum(%I) as gross', r->>'gross'); end if;
  if r ? 'profit' and (r->>'profit') = any(cols) then
    v_sel := v_sel || format('sum(%I) as profit', r->>'profit');
    if v_rev is not null then v_sel := v_sel || format('sum(%I) / nullif(sum(%I), 0) as margin', r->>'profit', v_rev); end if;
  elsif r ? 'margin' and v_rev is not null and (r->>'margin') = any(cols) then
    v_sel := v_sel || format('sum(%I * %I) / nullif(sum(%I), 0) as margin', r->>'margin', v_rev, v_rev);
  end if;
  if r ? 'qty' and (r->>'qty') = any(cols) then v_sel := v_sel || format('sum(%I) as qty', r->>'qty'); end if;
  if r ? 'location' and (r->>'location') = any(cols) then v_sel := v_sel || format('count(distinct %I) as locations', r->>'location'); end if;
  v_sel := v_sel || 'count(*) as records'::text;
  execute format('select coalesce(jsonb_agg(t order by t.period), ''[]'') from (select to_char(date_trunc(%L, %I::timestamp), %L) as period, %s from ds.%I where %I is not null group by 1) t',
    p_unit, v_date, v_fmt, array_to_string(v_sel, ', '), d.table_name, v_date) into v_res;
  return v_res;
end $$;
revoke execute on function public.ds_trend(uuid, text) from public, anon;
grant execute on function public.ds_trend(uuid, text) to authenticated, service_role;
