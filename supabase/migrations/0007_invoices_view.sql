-- Суммы считаем только по счетам и без повторов: один и тот же счёт часто лежит в нескольких папках/файлах,
-- а сводки, бюджеты и отчёты содержат итоги по другим документам (их складывать нельзя).
-- название контрагента без формы собственности: «FASTLINE EVENTS Sp. z o.o.» = «FASTLINE EVENTS SPÓŁKA Z OGRANICZONĄ…»
create or replace function public.party_name(t text) returns text language sql immutable as $$
  select nullif(btrim(regexp_replace(regexp_replace(upper(coalesce(t, '')), '\s*(SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ|SP\.?\s*Z\s*O\.?\s*O\.?|SPÓŁKA AKCYJNA|S\.A\.|SP\.?\s*K\.?|SP\.?\s*J\.?)\s*', ' ', 'g'), '\s+', ' ', 'g'), ' ,.-'), '')
$$;
grant execute on function public.party_name(text) to authenticated, service_role, ai_reader;
drop view if exists public.invoices;
create view public.invoices with (security_invoker = true) as
select distinct on (coalesce(nullif(regexp_replace(lower(number), '[^a-z0-9]', '', 'g'), ''), id::text), round(coalesce(gross, net)))
  id, title, path, category, doc_type, doc_date, counterparty, public.party_name(counterparty) as party, number, net, vat, gross, currency
from public.documents
where doc_type ilike 'faktura%' and coalesce(gross, net) is not null
order by coalesce(nullif(regexp_replace(lower(number), '[^a-z0-9]', '', 'g'), ''), id::text), round(coalesce(gross, net)), doc_date nulls last, created_at;
grant select on public.invoices to authenticated, ai_reader;
