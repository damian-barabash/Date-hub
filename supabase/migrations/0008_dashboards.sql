-- Дашборд вкладки строит ИИ из данных самой вкладки (не шаблон); результат хранится и пересобирается по запросу.
create table if not exists public.dashboards (
  category text primary key,
  content jsonb not null,
  doc_count int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.dashboards enable row level security;
drop policy if exists auth_read on public.dashboards;
create policy auth_read on public.dashboards for select to authenticated using (true);
drop policy if exists auth_del on public.dashboards;
create policy auth_del on public.dashboards for delete to authenticated using (true);
