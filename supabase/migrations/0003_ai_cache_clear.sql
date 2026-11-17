-- очистка кэша ответов ИИ (таблица доступна пользователям только на чтение)
create or replace function public.ai_cache_clear() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public._req();
  delete from public.ai_cache where true;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.ai_cache_clear() from public, anon;
grant execute on function public.ai_cache_clear() to authenticated, service_role;

insert into public.app_settings (key, value) values
  ('pricing', '{"input_hit":0.028,"input_miss":0.28,"output":0.42,"currency":"USD"}')
on conflict (key) do nothing;
