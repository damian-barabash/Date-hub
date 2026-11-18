// Финансовый реестр на клиенте: читаем готовые таблицы fin_* (их собирает сервер), при изменении документов — просим пересобрать.
import { supabase, fn } from '../supabase';

export interface FinRow {
  key: string; seller_code: string; seller: string; number: string; kind: string; issue_date: string | null;
  value_gross: number | null; value_net: number | null; open: number | null; pay_status: string; pay_asof: string | null; pay_source: string | null;
  order_no: string | null; subject: string | null; main_doc: string | null; doc_titles: string[] | null; counted: boolean;
}
export interface FinSummary {
  invoices: number; value_gross: number; value_net: number; gross_on_documents: number; duplicates_removed: number;
  open_confirmed: number; open_count: number; unknown_gross: number; unknown_count: number; advance_left: number;
  open_by_source: { source: string; asof: string | null; invoices: number; open: number; sellers: string[] }[];
  errors: string[]; warnings: number;
  sellers?: { code: string; open: number }[];
  list_check?: { source: string; asof: string | null; sellers: string[]; list_total: number; ledger_total: number; diffs: { number: string; seller: string; list_open: number; ledger_open: number; why: string }[] } | null;
}

export interface FinParty { code: string; name: string; role: string; nip: string }
/** kwota ustalona przez firmę (np. key 'receivables' = ile klient jest nam winien), pokazywana obok wyliczeń z dokumentów */
export interface FinFact { key: string; value: number; asof: string; note: string | null }

export const fin = $state({ rows: [] as FinRow[], summary: null as FinSummary | null, builtAt: '', checks: [] as { level: string; msg: string }[], parties: [] as FinParty[], facts: [] as FinFact[], loading: false });

let inflight: Promise<void> | null = null;
export function loadFinance(force = false): Promise<void> {
  if (inflight && !force) return inflight;
  inflight = (async () => {
    fin.loading = true;
    try {
      const { data: stale } = await supabase.rpc('fin_stale');
      if (stale || force) await fn('docs', { action: 'finance' }).catch(() => null);
      const [rows, meta, checks, parties, facts] = await Promise.all([
        supabase.from('fin_invoices').select('key,seller_code,seller,number,kind,issue_date,value_gross,value_net,open,pay_status,pay_asof,pay_source,order_no,subject,main_doc,doc_titles,counted').eq('counted', true).order('issue_date'),
        supabase.from('fin_meta').select('built_at, summary').eq('id', 1).maybeSingle(),
        supabase.from('fin_checks').select('level, msg').in('level', ['error', 'warn']).order('level').limit(60),
        supabase.from('fin_parties').select('code, name, role, nip'),
        supabase.from('fin_facts').select('key, value, asof, note'),
      ]);
      fin.parties = (parties.data ?? []) as FinParty[];
      fin.facts = ((facts.data ?? []) as any[]).map((f) => ({ ...f, value: Number(f.value) }));
      fin.rows = (rows.data ?? []) as FinRow[];
      fin.summary = (meta.data?.summary ?? null) as FinSummary | null;
      fin.builtAt = meta.data?.built_at ?? '';
      fin.checks = (checks.data ?? []) as { level: string; msg: string }[];
    } finally { fin.loading = false; inflight = null; }
  })();
  return inflight;
}

/** после загрузки/удаления документов — пересобрать реестр в фоне */
export const refreshFinance = () => fn('docs', { action: 'finance' }).then(() => loadFinance()).catch(() => null);

/** zapisuje (lub usuwa, gdy value = null) kwotę ustaloną przez firmę */
export async function saveFact(key: string, value: number | null, asof: string, note: string | null) {
  const r = value === null ? await supabase.from('fin_facts').delete().eq('key', key)
    : await supabase.from('fin_facts').upsert({ key, value, asof, note }, { onConflict: 'workspace_id,key' });
  if (r.error) throw r.error;
  const { data } = await supabase.from('fin_facts').select('key, value, asof, note');
  fin.facts = ((data ?? []) as any[]).map((f) => ({ ...f, value: Number(f.value) }));
}
