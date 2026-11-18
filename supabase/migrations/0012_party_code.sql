-- Фирма документа по NIP/реестру: documents.party_code (MTMC, FLE, FIQ, GW, CK…).
-- Варианты названий («MTM CONSULTING», «MARIUSZ MIĘKOŚ MTM CONSULTING», «MTM CONSULTING MARIUSZ MIĘKOŚ») → один код.
-- Счета получают код продавца прямо из реестра; остальные документы — по ядру названия фирмы в поле counterparty
-- (без пробелов и формы собственности; если подходят несколько фирм — та, что стоит в строке раньше).
alter table public.documents add column if not exists party_code text;
create index if not exists documents_party_idx on public.documents (workspace_id, party_code);

create or replace function public._core(t text) returns text language sql immutable as $$
  select regexp_replace(upper(coalesce(public.party_name(t), '')), '[^A-Z0-9ĄĆĘŁŃÓŚŹŻ]', '', 'g')
$$;

create or replace function public.fin_tag_documents(w uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.documents set party_code = null where workspace_id = w and party_code is not null;
  update public.documents d set party_code = f.seller_code
    from public.fin_invoices f where f.workspace_id = w and d.workspace_id = w and d.id = any(f.doc_ids);
  update public.documents d set party_code = m.code from (
    select distinct on (d2.id) d2.id, p.code
    from public.documents d2
    join public.fin_parties p on p.workspace_id = w
    cross join lateral unnest(p.aliases || p.name) a
    where d2.workspace_id = w and d2.party_code is null and length(public._core(a)) >= 3
      and strpos(public._core(d2.counterparty), public._core(a)) > 0
    order by d2.id, strpos(public._core(d2.counterparty), public._core(a)), length(public._core(a)) desc
  ) m where d.id = m.id;
end $$;
revoke execute on function public.fin_tag_documents(uuid) from public, anon, authenticated;

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
  perform public.fin_tag_documents(w);
end $$;
revoke execute on function public.fin_replace(jsonb) from public, anon, authenticated;
grant execute on function public.fin_replace(jsonb) to service_role;
