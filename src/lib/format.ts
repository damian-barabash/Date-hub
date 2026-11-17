import { i18n } from './i18n.svelte';

export type Fmt = 'pln' | 'pct' | 'int' | 'num' | undefined;
const loc = () => (i18n.lang === 'en' ? 'en-GB' : 'pl-PL');

export function pln(v: number | null | undefined, compact = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (compact || a >= 1e6) {
    if (a >= 1e9) return `${(v / 1e9).toLocaleString(loc(), { maximumFractionDigits: 2 })} ${i18n.lang === 'en' ? 'bn' : 'mld'} zł`;
    if (a >= 1e6) return `${(v / 1e6).toLocaleString(loc(), { maximumFractionDigits: 2 })} ${i18n.lang === 'en' ? 'M' : 'mln'} zł`;
    if (a >= 1e3 && compact) return `${(v / 1e3).toLocaleString(loc(), { maximumFractionDigits: 1 })} ${i18n.lang === 'en' ? 'k' : 'tys.'} zł`;
  }
  return `${v.toLocaleString(loc(), { maximumFractionDigits: a < 100 ? 2 : 0 })} zł`;
}
export const pct = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toLocaleString(loc(), { maximumFractionDigits: d, minimumFractionDigits: d })}%`;
export const int = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString(loc());
export const num = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString(loc(), { maximumFractionDigits: d });
export function compactNum(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString(loc(), { maximumFractionDigits: 1 })}M`;
  if (a >= 1e3) return `${(v / 1e3).toLocaleString(loc(), { maximumFractionDigits: 1 })}k`;
  return v.toLocaleString(loc(), { maximumFractionDigits: 2 });
}
export function fmt(v: unknown, f: Fmt, compact = false): string {
  if (typeof v !== 'number') return v === null || v === undefined ? '—' : String(v);
  switch (f) {
    case 'pln': return pln(v, compact);
    case 'pct': return pct(v);
    case 'int': return compact ? compactNum(v) : int(v);
    default: return compact ? compactNum(v) : num(v);
  }
}
export function axisFmt(f: Fmt) {
  return (v: number) => (f === 'pct' ? pct(v, Math.abs(v) < 1 && Math.round(v * 100) !== v * 100 ? 1 : 0) : f === 'pln' ? `${compactNum(v)} zł` : compactNum(v));
}
export const dateTime = (s: string) => new Date(s).toLocaleString(loc(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
/** «Bartosik Marlena» → «Bartosik M.» для подписей осей */
export const shortName = (s: string, max = 18) => (s && s.length > max ? s.slice(0, max - 1) + '…' : s);
