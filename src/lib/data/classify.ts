// Распознавание типа таблицы (чистые функции — работают и в Node-скриптах, и в браузере).
import type { Inferred } from './infer';

export type SheetKind = 'dataset' | 'directory' | 'document';

export const DIR_FIELDS: { k: string; re: RegExp }[] = [
  { k: 'code', re: /^(nazwa|kod_sklepu|kod_punktu|magazyn|symbol|code|sklep)$/ },
  { k: 'name', re: /(nazwa_wlasna|nazwa_handlowa|display|label)/ },
  { k: 'city', re: /(miasto|city|miejscowosc)/ },
  { k: 'street', re: /^(adres|ulica|address|street)$/ },
  { k: 'postal', re: /^(kod|kod_pocztowy|postal|zip)$/ },
  { k: 'branch', re: /(oddzial|branch|region)/ },
  { k: 'kind', re: /(rodzaj|typ|kind|type)/ },
  { k: 'email', re: /(e_mail|email|mail)/ },
  { k: 'store_id', re: /^(id|id_sklepu|store_id)$/ },
];

/** Соответствие колонок справочника точек; known — уже известные коды (из продаж). */
export function directoryMap(x: Inferred, known: Set<string>): Record<string, string> {
  const cols = x.columns.filter((c) => !c.derived).map((c) => c.key);
  const map: Record<string, string> = {};
  let bestCol = '', best = 0;
  for (const c of cols) {
    const vals = x.rows.slice(0, 500).map((r) => String(r[c] ?? ''));
    const hit = known.size ? vals.filter((v) => known.has(v)).length / Math.max(vals.length, 1) : 0;
    if (hit > best) { best = hit; bestCol = c; }
  }
  for (const f of DIR_FIELDS) {
    if (f.k === 'code' && best >= 0.3) { map.code = bestCol; continue; }
    const c = cols.find((k) => f.re.test(k) && !Object.values(map).includes(k) && (f.k !== 'street' || !x.rows.slice(0, 20).some((r) => String(r[k] ?? '').includes('@'))));
    if (c) map[f.k] = c;
  }
  if (!map.code) map.code = x.roles.location ?? cols.find((k) => /^nazwa$/.test(k)) ?? '';
  return map;
}

const METRICS = ['net', 'gross', 'qty', 'profit', 'price', 'cost', 'margin'] as const;
const DIMENSIONS = ['manager', 'location', 'product', 'product_id', 'category', 'brand', 'date', 'customer', 'city', 'region', 'employee'] as const;
// реестры счетов, списки заказов и бюджеты остаются документами — их читает финансовый движок
const LEDGER_HEADER = /(nr|numer)_?(faktury|dokumentu|zamowienia)|kwota_do_zaplaty|wplacono|zaplacono|budzet/;

export function classify(x: Inferred, known: Set<string>, sheetCount: number): { kind: SheetKind; map: Record<string, string>; reason: string } {
  const map = directoryMap(x, known);
  const keys = x.columns.map((c) => c.key);
  const rows = x.rows.length;
  if (map.code && map.city && map.street && !x.roles.net && !x.roles.gross && rows < 20000) return { kind: 'directory', map, reason: 'kod + miasto + adres' };
  if (keys.some((k) => LEDGER_HEADER.test(k))) return { kind: 'document', map, reason: 'zestawienie / budżet' };
  const metrics = METRICS.filter((r) => x.roles[r]).length;
  const dims = DIMENSIONS.filter((r) => x.roles[r]).length;
  const named = x.columns.filter((c) => !/^(empty|col|kolumna)_?\d*$/.test(c.key)).length / Math.max(x.columns.length, 1);
  if (rows >= 300 && metrics >= 1 && dims >= 1 && named >= 0.7 && (sheetCount <= 3 || rows >= 2000)) return { kind: 'dataset', map, reason: `${rows} wierszy, metryki i wymiary` };
  return { kind: 'document', map, reason: 'tekst' };
}

