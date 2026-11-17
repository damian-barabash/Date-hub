-- 1) SQL ИИ (роль ai_reader) должен видеть справочник точек — иначе JOIN по locations пустой
drop policy if exists ai_read on public.locations;
create policy ai_read on public.locations for select to ai_reader using (true);

-- 2) запрет служебных функций в SQL ИИ (sleep, управление сессиями, файлы)
create or replace function ai.run(p_sql text, p_limit int) returns jsonb
language plpgsql security definer set search_path = ds, public as $$
declare v_sql text := btrim(regexp_replace(p_sql, ';\s*$', '')); v_res jsonb;
begin
  if v_sql !~* '^\s*(select|with)\s' then raise exception 'only SELECT allowed'; end if;
  if v_sql ~ ';' then raise exception 'single statement only'; end if;
  if v_sql ~* '\m(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|do|execute|vacuum|set|reset|lock|listen|notify|dblink)\M'
     or v_sql ~* '(pg_[a-z_]+\s*\(|lo_[a-z_]+\s*\(|set_config|current_setting|query_to_xml|generate_series\s*\(\s*\d+\s*,\s*\d{7,})' then
    raise exception 'forbidden keyword or function';
  end if;
  execute format('select coalesce(jsonb_agg(t), ''[]'') from (select * from (%s) q limit %s) t', v_sql, least(p_limit, 2000))
    into v_res;
  return v_res;
end $$;
alter function ai.run(text, int) owner to ai_reader;
