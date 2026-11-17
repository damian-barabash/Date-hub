// Слой запросов к агрегатору ds_agg / ds_hist / ds_rows с кэшем в памяти:
// повторный заход на страницу — мгновенно, без запроса.
import { supabase } from '../supabase';
import type { Dataset } from '../stores/app.svelte';
import type { Role } from './infer';

export type Metric = { fn: string; col?: string; w?: string; val?: number; as: string };
export type Filter = { col: string; op: string; val?: unknown };
export interface AggSpec { group?: string[]; metrics: Metric[]; filters?: Filter[]; order?: { by: string; dir?: 'asc' | 'desc' }[]; limit?: number }
export type Row = Record<string, any>;

const cache = new Map<string, Promise<any>>();
const key = (d: Dataset, kind: string, spec: unknown) => `${d.id}:${d.version}:${kind}:${JSON.stringify(spec)}`;

function cached<T>(k: string, run: () => Promise<T>): Promise<T> {
  if (!cache.has(k)) {
    const p = run().catch((e) => { cache.delete(k); throw e; });
    cache.set(k, p);
  }
  return cache.get(k)!;
}
export const clearCache = () => cache.clear();

export function agg(d: Dataset, spec: AggSpec): Promise<Row[]> {
  return cached(key(d, 'agg', spec), async () => {
    const { data, error } = await supabase.rpc('ds_agg', { p_id: d.id, p_spec: spec });
    if (error) throw error;
    return (data ?? []) as Row[];
  });
}
export function hist(d: Dataset, col: string, edges?: number[], buckets = 12, filters: Filter[] = []): Promise<{ lo: number | null; hi: number | null; n: number }[]> {
  return cached(key(d, 'hist', { col, edges, buckets, filters }), async () => {
    const { data, error } = await supabase.rpc('ds_hist', { p_id: d.id, p_col: col, p_edges: edges ?? null, p_buckets: buckets, p_filters: filters });
    if (error) throw error;
    return data ?? [];
  });
}
export async function rows(d: Dataset, opts: { filters?: Filter[]; order?: { by: string; dir?: string }[]; limit?: number; offset?: number } = {}) {
  const { data, error } = await supabase.rpc('ds_rows', { p_id: d.id, p_filters: opts.filters ?? [], p_order: opts.order ?? [], p_limit: opts.limit ?? 50, p_offset: opts.offset ?? 0 });
  if (error) throw error;
  return data as { rows: Row[]; total: number };
}

// ───────── метрики по ролям колонок (работает для любого набора данных) ─────────
export interface Roles { r: Partial<Record<Role, string>>; revenue?: string; has: (role: Role) => boolean }
export function rolesOf(d: Dataset): Roles {
  const r = d.roles ?? {};
  return { r, revenue: r.net ?? r.gross, has: (role) => !!r[role] };
}

/** Стандартный набор метрик для группировки (выручка, прибыль, маржа, штуки…) */
export function stdMetrics(d: Dataset, extra: Metric[] = []): Metric[] {
  const { r, revenue } = rolesOf(d);
  const m: Metric[] = [];
  if (revenue) m.push({ fn: 'sum', col: revenue, as: 'revenue' });
  if (r.gross && r.net) m.push({ fn: 'sum', col: r.gross, as: 'gross' });
  if (r.profit) m.push({ fn: 'sum', col: r.profit, as: 'profit' });
  if (r.profit && revenue) m.push({ fn: 'ratio', col: r.profit, w: revenue, as: 'margin' });
  else if (r.margin && revenue) m.push({ fn: 'wavg', col: r.margin, w: revenue, as: 'margin' });
  if (r.qty) m.push({ fn: 'sum', col: r.qty, as: 'qty' });
  m.push({ fn: 'count', as: 'records' });
  return [...m, ...extra];
}

export function csvDownload(name: string, data: Row[]) {
  if (!data.length) return;
  const cols = Object.keys(data[0]);
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + [cols.join(';'), ...data.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${name}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
