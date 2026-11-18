-- Дашборды вкладок можно править вручную (удалить / переставить блок) — в своём воркспейсе.
drop policy if exists auth_upd on public.dashboards;
create policy auth_upd on public.dashboards for update to authenticated
  using (workspace_id = (select public.cur_ws())) with check (workspace_id = (select public.cur_ws()));
grant update on public.dashboards to authenticated;
