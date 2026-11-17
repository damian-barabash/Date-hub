// Агрегаты по точкам + справочник локаций (город, воеводство, отделение, тип).
import { agg, rolesOf, stdMetrics, type Row } from './api';
import type { Dataset, Location } from '../stores/app.svelte';

export async function locationStats(d: Dataset): Promise<Row[]> {
  const { r, revenue } = rolesOf(d);
  if (!r.location) return [];
  const extra = [
    ...(r.manager ? [{ fn: 'mode', col: r.manager, as: 'manager' }] : []),
    ...(r.product_id || r.product ? [{ fn: 'count_distinct', col: (r.product_id ?? r.product)!, as: 'products' }] : []),
  ];
  const rows = await agg(d, { group: [r.location], metrics: stdMetrics(d, extra), order: [{ by: revenue ? 'revenue' : 'records', dir: 'desc' }], limit: 5000 });
  return rows.map((x) => ({ ...x, loc: x[r.location!] }));
}

export function withDirectory(rows: Row[], locs: Location[]): Row[] {
  const by = new Map(locs.map((l) => [l.code, l]));
  return rows.map((x) => {
    const l = by.get(String(x.loc));
    return { ...x, name: l?.name?.replace(/\s+/g, ' ') ?? null, city: l?.city ?? '—', region: l?.region ?? '—', branch: l?.branch ?? '—', kind: l?.kind ?? '—', street: l?.street ?? null, geo: l?.status ?? 'none' };
  });
}

/** Сводка по полю справочника (city / region / branch / kind). */
export function rollup(rows: Row[], key: string): Row[] {
  const m = new Map<string, Row>();
  for (const x of rows) {
    const k = String(x[key] ?? '—');
    const a: Row = m.get(k) ?? { [key]: k, revenue: 0, profit: 0, qty: 0, points: 0 };
    a.revenue += x.revenue ?? 0; a.profit += x.profit ?? 0; a.qty += x.qty ?? 0; a.points += 1;
    m.set(k, a);
  }
  const hasProfit = rows.some((x) => x.profit !== undefined);
  return [...m.values()].map((a): Row => ({ ...a, margin: hasProfit && a.revenue ? a.profit / a.revenue : null, per_point: a.revenue / a.points })).sort((a, b) => b.revenue - a.revenue);
}
