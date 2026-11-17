// Распознавание структуры любых табличных данных (Excel, CSV, JSON из API/POS, внешняя БД).
// Общий модуль: используется в браузере и копируется в edge functions (supabase/functions/_shared).

export type ColType = 'number' | 'integer' | 'date' | 'datetime' | 'boolean' | 'text';
export type Role =
  | 'manager' | 'location' | 'product' | 'product_id' | 'category' | 'brand'
  | 'qty' | 'net' | 'gross' | 'margin' | 'cost' | 'profit' | 'price'
  | 'date' | 'city' | 'region' | 'lat' | 'lng' | 'customer' | 'employee';

export interface Derived { op: 'mul' | 'sub' | 'add' | 'div' | 'first_word' | 'prefix'; a: string; b?: string; sep?: string }
export interface Column {
  key: string;
  label: string;
  type: ColType;
  role?: Role;
  derived?: Derived;
  stats?: Record<string, unknown>;
}
export interface Inferred {
  columns: Column[];
  roles: Partial<Record<Role, string>>;
  rows: Record<string, unknown>[];
  meta: { notes: string[]; period?: string; skipped: number };
}

const PL: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

export function slug(s: string): string {
  const base = String(s ?? '')
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => PL[c] ?? c)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 50);
  if (!base) return 'col';
  return /^[a-z_]/.test(base) ? base : 'c_' + base;
}

// словарь синонимов (PL / EN / UA / RU), порядок важен: от более специфичных к общим
const ROLE_PATTERNS: [Role, RegExp][] = [
  ['product_id', /^(symbol|sku|ean|kod_towaru|kod_produktu|indeks|index|product_id|id_towaru|artykul_id|barcode)/],
  ['lat', /^(lat|latitude|szerokosc)/],
  ['lng', /^(lng|lon|long|longitude|dlugosc)/],
  ['manager', /(kierownik|manager|menedzer|opiekun|handlowiec|przedstawiciel|supervisor|regionalny)/],
  ['employee', /(pracownik|sprzedawca|kasjer|employee|seller|cashier|staff)/],
  ['location', /(magazyn|sklep|punkt|lokal|store|shop|warehouse|oddzial|placowka|filia|branch|outlet|salon)/],
  ['customer', /(klient|kontrahent|customer|client|odbiorca|nabywca)/],
  ['category', /(kategoria|category|grupa|group|segment|rodzaj|typ_towaru)/],
  ['brand', /(marka|brand|producent|manufacturer|vendor)/],
  ['product', /(nazwa_towaru|towar|produkt|product|artykul|item|nazwa|name)/],
  ['qty', /(ilosc|ilosc|qty|quantity|szt|sztuk|units|count|liczba)/],
  ['margin', /(marza|margin|narzut|markup)/],
  ['profit', /(zysk|profit|dochod)/],
  ['cost', /(koszt|cost|zakup|purchase)/],
  ['price', /(cena|price|stawka)/],
  ['net', /(netto|net|przychod|revenue|sprzedaz|obrot|sales|wartosc|kwota|amount|value)/],
  ['gross', /(brutto|gross)/],
  ['date', /(data|date|dzien|day|miesiac|month|okres|period|rok|year|czas|time)/],
  ['city', /(miasto|city|miejscowosc|town)/],
  ['region', /(region|wojewodztwo|voivodeship|province|obszar|area)/],
];

const isNum = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && /^-?\d[\d\s]*([.,]\d+)?$/.test(v.trim()));
const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/;
const DMY_RE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/;

function toDate(v: unknown): string | null {
  if (v instanceof Date) return isNaN(+v) ? null : v.toISOString();
  const s = String(v ?? '').trim();
  if (DATE_RE.test(s)) return s;
  const m = s.match(DMY_RE);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/** Строки-«подвалы» экспортов (например «Zastosowane filtry: …») → метаданные, а не данные. */
function isNoteRow(r: Record<string, unknown>, keys: string[]): string | null {
  const filled = keys.filter((k) => r[k] !== null && r[k] !== undefined && r[k] !== '');
  if (filled.length === 1) {
    const v = String(r[filled[0]]);
    if (v.length > 40 || /\n/.test(v) || /^(filtr|zastosowane|suma|razem|total|ogółem|ogolem)/i.test(v)) return v;
  }
  return null;
}

export function inferTable(raw: Record<string, unknown>[], opts: { sampleSize?: number } = {}): Inferred {
  const notes: string[] = [];
  const headers = Array.from(raw.slice(0, 200).reduce((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s; }, new Set<string>()));
  let rows = raw.filter((r) => {
    const n = isNoteRow(r, headers);
    if (n) { notes.push(n.replace(/\r/g, '').trim()); return false; }
    return headers.some((k) => r[k] !== null && r[k] !== undefined && r[k] !== '');
  });
  const skipped = raw.length - rows.length;

  // уникальные ключи колонок
  const used = new Set<string>();
  const keyOf: Record<string, string> = {};
  for (const h of headers) {
    let k = slug(h); let i = 2;
    while (used.has(k) || k === '_rid') k = `${slug(h)}_${i++}`;
    used.add(k); keyOf[h] = k;
  }

  const sample = rows.length > (opts.sampleSize ?? 3000) ? rows.filter((_, i) => i % Math.ceil(rows.length / (opts.sampleSize ?? 3000)) === 0) : rows;
  const columns: Column[] = headers.map((h) => {
    const vals = sample.map((r) => r[h]).filter((v) => v !== null && v !== undefined && v !== '');
    let type: ColType = 'text';
    if (vals.length) {
      if (vals.every((v) => typeof v === 'boolean' || /^(true|false|tak|nie)$/i.test(String(v)))) type = 'boolean';
      else if (vals.every(isNum)) {
        const nums = vals.map(toNum).filter((n): n is number => n !== null);
        type = nums.every((n) => Number.isInteger(n) && Math.abs(n) < 9e15) ? 'integer' : 'number';
        // коды/артикулы, похожие на числа, оставляем текстом (ведущие нули, «symbol», «kod»)
        if (/symbol|kod|sku|ean|indeks|index|id$|_id|nip|pesel|telefon|phone|zip|postal/i.test(slug(h))) type = 'text';
        if (vals.some((v) => typeof v === 'string' && /^0\d/.test(v))) type = 'text';
      } else if (vals.every((v) => v instanceof Date || toDate(v))) {
        type = vals.some((v) => (v instanceof Date && (v.getHours() || v.getMinutes())) || /\d{2}:\d{2}/.test(String(v))) ? 'datetime' : 'date';
      }
    }
    return { key: keyOf[h], label: String(h).replace(/\s+/g, ' ').trim(), type };
  });

  // роли
  const roles: Partial<Record<Role, string>> = {};
  for (const c of columns) {
    const k = c.key;
    for (const [role, re] of ROLE_PATTERNS) {
      if (roles[role]) continue;
      if (!re.test(k)) continue;
      const numeric = c.type === 'number' || c.type === 'integer';
      const numericRoles: Role[] = ['qty', 'net', 'gross', 'margin', 'cost', 'profit', 'price', 'lat', 'lng'];
      if (numericRoles.includes(role) !== numeric) continue;
      if (role === 'date' && !(c.type === 'date' || c.type === 'datetime' || /rok|miesiac|month|okres|period/.test(k))) continue;
      roles[role] = k; c.role = role; break;
    }
  }
  // если нет netto, но есть одна «денежная» колонка — используем её как выручку
  if (!roles.net && roles.gross) { /* gross станет основной метрикой на клиенте */ }

  // нормализация значений
  const out = rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const h of headers) {
      const c = columns.find((x) => x.key === keyOf[h])!;
      const v = r[h];
      if (v === null || v === undefined || v === '') { o[c.key] = null; continue; }
      switch (c.type) {
        case 'number': o[c.key] = toNum(v); break;
        case 'integer': { const n = toNum(v); o[c.key] = n === null ? null : Math.round(n); break; }
        case 'boolean': o[c.key] = typeof v === 'boolean' ? v : /^(true|tak)$/i.test(String(v)); break;
        case 'date': case 'datetime': o[c.key] = toDate(v); break;
        default: o[c.key] = String(v).replace(/\r/g, '').trim();
      }
    }
    return o;
  });

  // производные колонки
  const has = (k?: string) => !!k && columns.some((c) => c.key === k);
  if (roles.net && roles.margin && !roles.profit) {
    const m = columns.find((c) => c.key === roles.margin)!;
    const mv = out.map((r) => r[m.key] as number).filter((v) => typeof v === 'number');
    const ratio = mv.length && mv.filter((v) => v <= 1).length / mv.length > 0.9; // маржа как доля 0..1
    if (ratio && !has('zysk')) {
      columns.push({ key: 'zysk', label: 'Zysk (netto × marża)', type: 'number', role: 'profit', derived: { op: 'mul', a: roles.net, b: roles.margin } });
      roles.profit = 'zysk';
    }
  }
  if (roles.net && roles.qty && !roles.price && !has('cena_szt')) {
    columns.push({ key: 'cena_szt', label: 'Cena netto / szt. (auto)', type: 'number', role: 'price', derived: { op: 'div', a: roles.net, b: roles.qty } });
    roles.price = 'cena_szt';
  }
  if (roles.product && !roles.category && !has('kategoria')) {
    columns.push({ key: 'kategoria', label: 'Kategoria (auto)', type: 'text', role: 'category', derived: { op: 'first_word', a: roles.product } });
    roles.category = 'kategoria';
  }
  if (roles.location && !roles.city && !has('kod_miasta')) {
    const lv = out.slice(0, 500).map((r) => String(r[roles.location!] ?? ''));
    if (lv.filter((v) => /^[A-ZĄĆĘŁŃÓŚŹŻ]{2,4}-/.test(v)).length / Math.max(lv.length, 1) > 0.8) {
      columns.push({ key: 'kod_miasta', label: 'Kod miasta (auto)', type: 'text', derived: { op: 'prefix', a: roles.location, sep: '-' } });
    }
  }

  // период из заметок экспорта («Rok_miesiąc jest równa 2025_11»)
  let period: string | undefined;
  for (const n of notes) {
    const m = n.match(/(20\d{2})[_\-./](\d{1,2})/);
    if (m) { period = `${m[1]}-${m[2].padStart(2, '0')}`; break; }
  }
  return { columns, roles, rows: out, meta: { notes, period, skipped } };
}

/** Деление на пакеты для загрузки по RPC (лимит размера тела запроса). */
export function chunks<T>(arr: T[], size: number): T[][] {
  const res: T[][] = [];
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
  return res;
}

/** Достаёт массив строк из произвольного JSON (POS/REST): по пути «data.items» или первый массив объектов. */
export function pickArray(json: unknown, path?: string): Record<string, unknown>[] {
  let cur: unknown = json;
  if (path) for (const p of path.split('.').filter(Boolean)) cur = (cur as Record<string, unknown>)?.[p];
  if (Array.isArray(cur)) return cur.map((x) => flatten(x));
  if (cur && typeof cur === 'object') {
    for (const v of Object.values(cur as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v.map((x) => flatten(x));
    }
    for (const v of Object.values(cur as Record<string, unknown>)) {
      const r = pickArray(v);
      if (r.length) return r;
    }
  }
  return [];
}

function flatten(o: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) { out[prefix || 'value'] = Array.isArray(o) ? JSON.stringify(o) : o; return out; }
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) flatten(v, key, out);
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return out;
}
