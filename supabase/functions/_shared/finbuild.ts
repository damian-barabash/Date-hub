// Пересборка финансового реестра на сервере: тексты документов → движок → таблицы fin_* (одной транзакцией).
import { buildLedger, financeSummary, joinChunks, ledgerRows } from './finance.ts';
import type { admin } from './util.ts';

export async function rebuildFinance(db: ReturnType<typeof admin>, ws: string) {
  const t0 = Date.now();
  const { data, error } = await db.rpc('fin_sources');
  if (error) throw error;
  const docs = ((data ?? []) as any[]).map((d) => ({ id: d.id, title: d.title, path: d.path, ext: d.ext, created_at: d.created_at, text: joinChunks(d.chunks ?? []) }));
  const ledger = buildLedger(docs);
  const summary = financeSummary(ledger);
  const [{ count }, { data: last }] = await Promise.all([
    db.from('documents').select('id', { count: 'exact', head: true }).eq('workspace_id', ws),
    db.from('documents').select('created_at').eq('workspace_id', ws).order('created_at', { ascending: false }).limit(1),
  ]);
  const { error: e2 } = await db.rpc('fin_replace', { p: { ...ledgerRows(ledger), summary, doc_count: count ?? 0, docs_changed_at: last?.[0]?.created_at ?? null } });
  if (e2) throw e2;
  return { ...summary, ms: Date.now() - t0 };
}

/** если документы изменились после последней сборки — пересобрать */
export async function ensureFinance(db: ReturnType<typeof admin>, ws: string) {
  const { data: stale } = await db.rpc('fin_stale');
  if (stale) { try { await rebuildFinance(db, ws); } catch (e) { console.error('finance rebuild failed', e); } }
  const { data } = await db.from('fin_meta').select('built_at, summary').eq('workspace_id', ws).maybeSingle();
  return data as { built_at: string; summary: ReturnType<typeof financeSummary> } | null;
}
