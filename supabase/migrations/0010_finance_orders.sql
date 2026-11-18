-- Заказы (zamówienia GW/…): стоимость из реестров фирмы + переносы авансов нотами; сравнение «заказано → выставлено → открыто».
create table if not exists public.fin_order_values (
  order_no text primary key, subject text, date date, seller text,
  value_net numeric(14,2),            -- wartość zamówienia netto (najnowsze zestawienie)
  moved_in numeric(14,2) not null default 0, moved_out numeric(14,2) not null default 0, -- zaliczki przeniesione notami (brutto)
  sources jsonb not null default '[]', issues text[] not null default '{}'
);
alter table public.fin_order_values enable row level security;
drop policy if exists auth_read on public.fin_order_values;
create policy auth_read on public.fin_order_values for select to authenticated using (true);
drop policy if exists ai_read on public.fin_order_values;
create policy ai_read on public.fin_order_values for select to ai_reader using (true);
grant select on public.fin_order_values to authenticated, ai_reader;

create or replace function public.fin_replace(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.fin_invoices where true;
  delete from public.fin_parties where true;
  delete from public.fin_payments where true;
  delete from public.fin_allocations where true;
  delete from public.fin_checks where true;
  delete from public.fin_order_values where true;
  insert into public.fin_invoices select * from jsonb_populate_recordset(null::public.fin_invoices, p->'invoices');
  insert into public.fin_parties select * from jsonb_populate_recordset(null::public.fin_parties, p->'parties');
  insert into public.fin_payments select * from jsonb_populate_recordset(null::public.fin_payments, p->'payments');
  insert into public.fin_allocations select * from jsonb_populate_recordset(null::public.fin_allocations, p->'allocations');
  insert into public.fin_checks (level, code, msg, key) select level, code, msg, key from jsonb_populate_recordset(null::public.fin_checks, p->'checks');
  insert into public.fin_order_values select * from jsonb_populate_recordset(null::public.fin_order_values, coalesce(p->'orders', '[]'));
  insert into public.fin_meta (id, built_at, doc_count, docs_changed_at, sources, summary)
  values (1, now(), (p->>'doc_count')::int, (p->>'docs_changed_at')::timestamptz, p->'sources', p->'summary')
  on conflict (id) do update set built_at = excluded.built_at, doc_count = excluded.doc_count, docs_changed_at = excluded.docs_changed_at, sources = excluded.sources, summary = excluded.summary;
end $$;
revoke execute on function public.fin_replace(jsonb) from public, anon, authenticated;
grant execute on function public.fin_replace(jsonb) to service_role;

-- по заказу: стоимость заказа, выставлено без дублей (с учётом переносов авансов нотами), осталось выставить, открыто к оплате
drop view if exists public.fin_orders;
create view public.fin_orders with (security_invoker = true) as
  with inv as (
    select order_no, string_agg(distinct seller_code, ', ') as sellers, count(*) filter (where kind <> 'korekta') as invoices,
           sum(value_net) as inv_net, sum(value_gross) as inv_gross,
           sum(open) filter (where pay_status in ('niezapłacona','częściowo')) as open,
           sum(value_gross) filter (where pay_status = 'brak danych') as status_unknown,
           sum(advance_left) filter (where kind = 'zaliczkowa' and advance_left > 0) as advance_left,
           min(issue_date) as first_invoice, max(issue_date) as last_invoice,
           (array_agg(subject order by issue_date) filter (where subject is not null))[1] as inv_subject
    from public.fin_invoices where counted and order_no is not null group by order_no)
  select coalesce(v.order_no, i.order_no) as order_no, coalesce(v.subject, i.inv_subject) as subject, v.date as order_date, i.sellers,
         v.value_net as order_value_net,
         round(coalesce(i.inv_gross, 0) - coalesce(v.moved_out, 0) + coalesce(v.moved_in, 0), 2) as invoiced_gross,
         round(coalesce(i.inv_net, 0) - (coalesce(v.moved_out, 0) - coalesce(v.moved_in, 0)) / 1.23, 2) as invoiced_net,  -- noty przenoszą zaliczki brutto 23%
         round(v.value_net - (coalesce(i.inv_net, 0) - (coalesce(v.moved_out, 0) - coalesce(v.moved_in, 0)) / 1.23), 2) as remaining_net,
         coalesce(i.invoices, 0) as invoices, i.open, i.status_unknown, i.advance_left, v.moved_in, v.moved_out, i.first_invoice, i.last_invoice, v.issues
  from public.fin_order_values v full join inv i on i.order_no = v.order_no;
grant select on public.fin_orders to authenticated, ai_reader;
