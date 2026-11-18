-- 1) Kontrahenci: każdy dokument dostaje firmę (party_code), nie tylko te z faktur.
--    Pole counterparty bywa „Anna Szmidt / Fastline Advertising Sp. z o.o. (greywolfgroup.pl)” — wybieramy z niego firmę
--    (segment z formą prawną albo słowem typu Kancelaria/Group/Network), bez osób i e-maili.
--    Warianty jednej firmy łączymy: po NIP-ie z rejestru (fin_parties), z literówką (levenshtein), z dopiskiem (.pl, Mec.).
-- 2) fin_facts: kwoty ustalone przez firmę (np. „CK jest nam winne X na dzień D”) — AI i przegląd pokazują je obok wyliczeń z dokumentów.
create extension if not exists fuzzystrmatch with schema extensions;

create or replace function public._firm_seg(t text) returns text language sql immutable as $$
  select s.seg from regexp_split_to_table(coalesce(t, ''), '\s*(/|·|\(|\)|,|;|\||\s-\s)\s*') with ordinality s(seg, ord)
  where s.seg !~ '@' and length(s.seg) > 2
    and upper(s.seg) ~ '(SP\.?\s*Z\s*O|S\.A\.|\mSA\M|SPÓŁKA|KANCELARIA|TAX|\mLAW\M|GROUP|CONSULTING|AGENCJA|STUDIO|FUNDACJA|BANK|URZĄD|\mLTD|GMBH|\mINC\M|ADVERTISING|NETWORK|MEDIA|SOFTWARE|HOUSE|POLSKA)'
  order by s.ord limit 1
$$;

create or replace function public._firm_core(t text) returns text language sql immutable as $$
  select regexp_replace(public._core(regexp_replace(upper(coalesce(t, '')), '\m(MEC|ADW|R\.\s*PR|DR|MGR)\.?\s', ' ', 'g')), '(PL|COM|EU)$', '')
$$;

create or replace function public.fin_tag_documents(w uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  update public.documents set party_code = null where workspace_id = w and party_code is not null;
  -- a) faktury z rejestru: kod sprzedawcy
  update public.documents d set party_code = f.seller_code
    from public.fin_invoices f where f.workspace_id = w and d.workspace_id = w and d.id = any(f.doc_ids);
  -- b) znane firmy (NIP) po rdzeniu nazwy — wcześniejsza w tekście wygrywa
  update public.documents d set party_code = m.code from (
    select distinct on (d2.id) d2.id, p.code
    from public.documents d2
    join public.fin_parties p on p.workspace_id = w
    cross join lateral unnest(p.aliases || p.name) a
    where d2.workspace_id = w and d2.party_code is null and length(public._core(a)) >= 3
      and strpos(public._core(d2.counterparty), public._core(a)) > 0
    order by d2.id, strpos(public._core(d2.counterparty), public._core(a)), length(public._core(a)) desc
  ) m where d.id = m.id;
  -- c) pozostałe: firma z pola counterparty
  drop table if exists _f;
  create temp table _f on commit drop as
    select d.id, public.party_name(public._firm_seg(d.counterparty)) label, public._firm_core(public._firm_seg(d.counterparty)) core
    from public.documents d where d.workspace_id = w and d.party_code is null and public._firm_seg(d.counterparty) is not null;
  delete from _f where length(core) < 3 or core in ('KANCELARIA', 'GROUP', 'SA', 'CONSULTING', 'AGENCJA', 'STUDIO', 'MEDIA', 'POLSKA', 'BANK');
  --    literówka w znanej firmie („Fastine InfinitiQ” = FIQ, „Greywold” = GW)
  update public.documents d set party_code = m.code from (
    select distinct on (f.id) f.id, p.code from _f f
    join public.fin_parties p on p.workspace_id = w
    cross join lateral unnest(p.aliases || p.name) a
    where length(public._core(a)) >= 6
      and (levenshtein(f.core, public._core(a)) <= 2 or levenshtein(left(f.core, length(public._core(a))), public._core(a)) <= 1)
    order by f.id, levenshtein(f.core, public._core(a))
  ) m where d.id = m.id;
  delete from _f f using public.documents d where d.id = f.id and d.party_code is not null;
  --    warianty jednej nowej firmy: rdzeń zawierający częstszy rdzeń → ten częstszy; etykieta = najczęstszy zapis
  update public.documents d set party_code = g.label from (
    with n as (select core, count(*) c from _f group by core),
    canon as (select n1.core, (select n2.core from n n2 where length(n2.core) >= 6 and strpos(n1.core, n2.core) > 0 order by n2.c desc, length(n2.core) limit 1) cc from n n1),
    lab as (select coalesce(c.cc, f.core) cc, mode() within group (order by f.label) label from _f f join canon c on c.core = f.core group by 1)
    select f.id, l.label from _f f join canon c on c.core = f.core join lab l on l.cc = coalesce(c.cc, f.core)
  ) g where d.id = g.id;
end $$;
revoke execute on function public.fin_tag_documents(uuid) from public, anon, authenticated;

-- kwoty ustalone przez firmę
create table if not exists public.fin_facts (
  workspace_id uuid not null default public.cur_ws() references public.workspaces(id) on delete cascade,
  key text not null,              -- 'receivables' = ile klient jest nam winien łącznie
  value numeric(14,2) not null,
  asof date not null default current_date,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (workspace_id, key)
);
alter table public.fin_facts enable row level security;
drop policy if exists ws_all on public.fin_facts;
create policy ws_all on public.fin_facts for all to authenticated
  using (workspace_id = (select public.cur_ws())) with check (workspace_id = (select public.cur_ws()));
grant select, insert, update, delete on public.fin_facts to authenticated;
grant select on public.fin_facts to ai_reader;

-- firmy z dokumentów (po scaleniu) — dla AI: „jacy są nasi kontrahenci”
create or replace function public.doc_parties() returns table (code text, docs int, first_date date, last_date date)
language sql stable security definer set search_path = public as $$
  select party_code, count(*)::int, min(doc_date), max(doc_date) from public.documents
  where workspace_id = public._ws() and party_code is not null group by 1 order by 2 desc
$$;
revoke execute on function public.doc_parties() from public, anon;
grant execute on function public.doc_parties() to authenticated, service_role;
