// Финансовый движок AI DATA HUB: из ТЕКСТА документов строит реестр счетов «один счёт = одна строка».
// Никакого ИИ: числа берутся только из документов и реестров фирмы, всё сверяется до гроша.
//
//  1. Счёт (PDF/скан) → разбор: продавец и покупатель по NIP, номер, даты, нетто/VAT/брутто, к оплате,
//     вид (faktura / zaliczkowa / rozliczeniowa / korekta), какую зáлику закрывает, какую фактуру корректирует, заказ GW/…
//  2. Ключ счёта = NIP продавца + канонический номер (FV/26/03/3 ≡ 3/03/2026, KOR/26/04/1 ≡ KOR/1/04/2026),
//     поэтому копии в разных папках и разные форматы номера склеиваются, а одинаковые номера разных фирм — нет.
//  3. Реестры фирмы (xlsx «Nr Faktury | … | Wpłacono | Kwota do zapłaty») → статус оплаты; побеждает самый свежий срез.
//  4. Подтверждения банка (Potwierdzenie transakcji / PRZELEW) → оплата, а не счёт.
//  5. Экономическая стоимость считается один раз: rozliczeniowa = брутто − закрытая зáлика, korekta = её дельта.
// Модуль без зависимостей: работает в браузере, в Node (скрипты) и в Deno (edge `docs`).

export interface SrcDoc { id: string; title: string; path?: string; ext?: string; created_at?: string; text: string }

export type Kind = 'faktura' | 'zaliczkowa' | 'rozliczeniowa' | 'korekta';

export interface Party { nip: string; name: string; code: string; aliases: string[]; role: 'seller' | 'buyer' }

export interface Observation {
  source: string; source_id: string; sheet?: string; asof: string | null;
  gross: number | null; paid: number | null; open: number | null; paid_date: string | null; status: string | null;
}

export interface Invoice {
  key: string; seller_nip: string; seller: string; seller_code: string; buyer_nip: string | null; buyer: string | null;
  number: string; number_key: string; kind: Kind;
  issue_date: string | null; sale_date: string | null; due_date: string | null;
  net: number | null; vat: number | null; gross: number | null;
  value_net: number | null; value_gross: number | null; // сколько этот документ добавляет к общей сумме (без двойного счёта)
  advance_used: { ref: string; gross: number }[]; advance_left: number | null; counted: boolean;
  settles: string[]; corrects: string | null; order_no: string | null; subject: string | null; project: string | null; stage: string | null;
  paid: number | null; open: number | null; paid_date: string | null;
  pay_status: 'zapłacona' | 'częściowo' | 'niezapłacona' | 'rozliczona zaliczką' | 'skorygowana' | 'brak danych';
  pay_source: string | null; pay_asof: string | null;
  doc_ids: string[]; doc_titles: string[]; main_doc: string | null;
  in_registry: boolean; observations: Observation[]; issues: string[];
}

export interface Payment { doc_id: string; title: string; date: string | null; amount: number; payer: string | null; payee: string | null; refs: string[]; matched: string | null }
export interface Allocation { doc_id: string; title: string; number: string; date: string | null; seller_nip: string | null; amount: number; from_order: string | null; to_order: string | null; text: string }
export interface Order {
  order_no: string; subject: string | null; date: string | null; seller: string | null;
  value_net: number | null;   // wartość zamówienia netto (najnowsze źródło)
  moved_in: number; moved_out: number; // zaliczki przeniesione notami na / z tego zamówienia (brutto)
  sources: { title: string; sheet: string; col: string; value: number }[]; issues: string[];
}

export interface Ledger {
  built_at: string; parties: Party[]; invoices: Invoice[]; payments: Payment[]; allocations: Allocation[]; orders: Order[];
  sources: { id: string; title: string; kind: 'invoice' | 'registry' | 'payment' | 'note' | 'skipped'; asof?: string | null; rows?: number; note?: string }[];
  checks: { level: 'error' | 'warn' | 'info'; code: string; msg: string; key?: string }[];
}

// ───────────────────────── утилиты ─────────────────────────
const r2 = (n: number) => Math.round(n * 100) / 100;
const eq = (a: number | null, b: number | null, tol = 0.011) => a !== null && b !== null && Math.abs(a - b) <= tol;

/** «123 000,00 zł», « 1,234.56 zł », «-100,000.00», «- zł» → число */
export function amount(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  let t = String(s).replace(/zł|pln|"| /gi, '').trim();
  if (/^-\s*$/.test(t)) return 0;
  if (!/\d/.test(t)) return null;
  const neg = /^-|^\(.*\)$/.test(t);
  t = t.replace(/[^\d.,]/g, '');
  if (/,\d{2}$/.test(t)) t = t.replace(/[.\s]/g, '').replace(',', '.');           // 1.234,56 / 1234,56
  else if (/\.\d{1,2}$/.test(t)) t = t.replace(/,/g, '');                         // 1,234.56
  else t = t.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.');               // 1,234 / 1.234
  const n = Number(t);
  return Number.isFinite(n) ? r2(neg ? -n : n) : null;
}

const AMT = String.raw`-?\d{1,3}(?:[  .]\d{3})*,\d{2}|-?\d+,\d{2}`;
const amtAll = (s: string) => [...s.matchAll(new RegExp(AMT, 'g'))].map((m) => amount(m[0])!);

/** дата в ISO: 31.12.2025, 31-12-2025, 2025-12-31, 12/31/25 (US из xlsx), excel serial */
export function isoDate(s: string | null | undefined, us = false): string | null {
  if (!s) return null;
  const t = String(s).trim().replace(/"/g, '');
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return fmt(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})/);
  if (m) return fmt(+m[3], +m[2], +m[1]);
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return us ? fmt(y, +m[1], +m[2]) : fmt(y, +m[2], +m[1]); }
  if (/^\d{5}$/.test(t)) { const d = new Date(Date.UTC(1899, 11, 30) + +t * 864e5); return d.toISOString().slice(0, 10); }
  return null;
}
function fmt(y: number, mo: number, d: number): string | null {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const nipOf = (s: string) => s.replace(/\D/g, '').slice(-10);
const NIP_RE = /NIP[:\s]*(?:PL)?\s*([0-9]{3}[- ]?[0-9]{2,3}[- ]?[0-9]{2}[- ]?[0-9]{2,3})/gi;
function nips(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(NIP_RE)) { const n = nipOf(m[1]); if (n.length === 10 && !out.includes(n)) out.push(n); }
  return out;
}

/** канонический номер: FV/26/03/3 ≡ 3/03/2026 ≡ FV 3_03_2026; FZ ≡ ZAL; 04/08/2025_4 → 2025|08|4_4 */
export function numberKey(raw: string, kindHint?: Kind | 'nota'): string {
  let s = String(raw).toUpperCase().replace(/^(NR|NUMER)\s*/, '').trim();
  // Excel превратил «8/04/2026» в дату «4/8/26» (US m/d/yy) → возвращаем SEQ/MM/YYYY
  const us = s.match(/^([A-Z]{0,4}[\s/]*)?(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (us) s = `${us[1] ?? ''}${us[3]}/${us[2]}/20${us[4]}`;
  s = s.replace(/\/(\d{1,2})(20\d{2})\b/, '/$1/$2'); // «01/052026» → «01/05/2026»
  let prefix = '';
  const pm = s.match(/^([A-Z]{1,4})(?=[\s/._\-]*\d)/);
  if (pm) { prefix = pm[1]; s = s.slice(pm[0].length); }
  if (/^NRFZ$|^FZ$/.test(prefix)) prefix = 'ZAL';
  if (/^(FV|F|FA|FS|NR|VAT)$/.test(prefix)) prefix = '';
  if (kindHint === 'nota') prefix = 'NK';
  else if (kindHint === 'zaliczkowa' && !prefix) prefix = 'ZAL';
  else if (kindHint === 'korekta' && !prefix) prefix = 'KOR';
  const t = s.split(/[^0-9]+/).filter(Boolean).map((x) => String(+x));
  let core: string;
  if (t.length >= 3 && +t[2] >= 2000) core = `${t[2]}|${t[1].padStart(2, '0')}|${t[0]}${t[3] ? `_${t[3]}` : ''}`;             // SEQ/MM/YYYY[_n]
  else if (t.length >= 3 && +t[0] >= 20 && +t[0] <= 40 && +t[1] >= 1 && +t[1] <= 12) core = `${2000 + +t[0]}|${t[1].padStart(2, '0')}|${t[2]}`; // YY/MM/SEQ
  else core = t.join('/');
  return `${prefix}|${core}`;
}

const clean = (s: string | null | undefined) => (s ? String(s).replace(/\s+/g, ' ').trim() : null);

// ───────────────────────── разбор одного счёта ─────────────────────────
export interface ParsedInvoice {
  kind: Kind | 'nota'; number: string; seller_nip: string | null; buyer_nip: string | null; seller_name: string | null; buyer_name: string | null;
  issue_date: string | null; sale_date: string | null; due_date: string | null;
  net: number | null; vat: number | null; gross: number | null; to_pay: number | null; paid_in_doc: number | null; paid_date: string | null;
  settles: string[]; corrects: string | null; order_no: string | null; subject: string | null; confidence: number; issues: string[];
  advance_used: { ref: string; gross: number }[];
}

const ORDER_RE = /GW[\s./_-]*(\d{1,2})[\s./_-]+(\d{1,2})[\s./_-]+(20\d{2})/i;
export const orderKey = (s: string | null | undefined): string | null => {
  const m = s ? String(s).match(ORDER_RE) : null;
  return m ? `GW/${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}` : null;
};

/** подтверждение банковского перевода (не счёт!) */
export function parsePayment(title: string, text: string): Omit<Payment, 'doc_id' | 'title' | 'matched'> | null {
  const t = text.replace(/\r/g, '');
  const isConfirm = /potwierdzenie transakcji|potwierdzenie (wykonania )?przelewu|nr tr:|data księgowania/i.test(t) || (/potwierdz/i.test(title) && /przelew/i.test(t));
  if (!isConfirm || t.length > 5000 || /\.(docx?|pptx?|xlsx?)$/i.test(title)) return null;
  if (/sprzedawca[\s\S]{0,200}nabywca/i.test(t) && /razem/i.test(t)) return null; // это сам счёт
  const amts = [...t.matchAll(/(?:kwota[^\n]*?|przelew\s*)(-?\d{1,3}(?:[ .]\d{3})*,\d{2})/gi)].map((m) => amount(m[1])!).filter((x) => x > 0);
  const any = amtAll(t).filter((x) => x > 0);
  const amt = amts[0] ?? any.sort((a, b) => b - a)[0];
  if (!amt) return null;
  const date = isoDate(t.match(/data transakcji:?\s*([\d.\-]+)/i)?.[1]) ?? isoDate(t.match(/data księgowania:?\s*([\d.\-]+)/i)?.[1]) ?? isoDate(t.match(/(\d{2}\.\d{2}\.\d{4})/)?.[1]);
  const refs = new Set<string>();
  const inv = t.replace(/\s+/g, ' ').match(/\/INV\/([A-Z0-9/ ]+?)\/TXT/i);
  if (inv) refs.add(inv[1].replace(/\s+/g, ''));
  for (const m of t.matchAll(/\b(?:NR\s*)?((?:FV|FZ|ZAL|FVR|KOR)[\s/._-]*\d{1,4}[/._-]\d{1,2}[/._-]\d{1,4}(?:_\d)?)/gi)) refs.add(m[1].replace(/\s+/g, ''));
  for (const m of title.matchAll(/((?:FV|FZ|ZAL|FVR|KOR)[\s._-]*\d{1,4}[._-]\d{1,2}[._-]\d{1,4}(?:_\d)?)/gi)) refs.add(m[1].replace(/\s+/g, ''));
  const payee = clean(t.match(/dane odbiorcy:?[\s\S]{0,160}?\n\s*[\d ]{20,}\s*\n([\s\S]{0,80})/i)?.[1]);
  return { date, amount: amt, payer: /CK COMPLEX/i.test(t) ? 'CK COMPLEX' : null, payee: payee ?? null, refs: [...refs] };
}

/** счёт / зáлика / rozliczeniowa / korekta / nota księgowa */
export function parseInvoice(title: string, text: string): ParsedInvoice | null {
  const t = text.replace(/\r/g, '').replace(/\f/g, '\n');
  const flat = t.replace(/\s+/g, ' ');
  const issues: string[] = [];
  if (parsePayment(title, t)) return null;
  const isNota = /NOTA KSI[ĘE]GOWA/i.test(flat);
  const isKor = /\bKorekta (?:nr|Nr)\b|FAKTURA KORYGUJĄCA/i.test(flat);
  const isZal = /FAKTURA ZALICZKOWA|Faktura zaliczkowa nr|Rodzaj faktury:? *Zaliczkowa/i.test(flat) && !isKor && !/Faktura rozliczeniowa|do Faktury zaliczkowej/i.test(flat);
  const isRozl = /Faktura Rozliczeniowa|rozliczenie zaliczki|Faktura końcowa|Rodzaj faktury:? *Rozliczeniowa/i.test(flat);
  const isInv = /\bFaktura\b|\bFAKTURA\b|Numer Faktury|Krajowy System e-Faktur/i.test(flat) || isNota || isKor;
  if (!isInv) return null;
  // e-mail с приложенным счётом: если нет таблицы сумм и двух NIP — это не счёт
  const ns = nips(t);
  // номер
  let number: string | null = null;
  const numPats: RegExp[] = isNota ? [/NOTA KSI[ĘE]GOWA\s*(?:NR|nr)?\s*([0-9][0-9/._-]+)/] : isKor ? [/Korekta\s*(?:nr|Nr)\s*([A-Z]{0,4}\/?[0-9][0-9/._-]*)/] : [
    /Numer Faktury:?\s*([A-Z]{0,4}\/?[0-9][0-9/._-]*)/i,
    /Faktura (?:VAT |zaliczkowa |rozliczeniowa |końcowa )?(?:nr|Nr|NR)\s*([A-Z]{0,4}\/?[0-9][0-9/._-]*)/,
    /FAKTURA (?:VAT |ZALICZKOWA |ROZLICZENIOWA |KOŃCOWA )?(?:NR|nr)\s*([A-Z]{0,4}\/?[0-9][0-9/._-]*)/,
    /(?:^|\n)\s*Nr\s+([A-Z]{0,4}\/?[0-9]{1,4}\/[0-9]{1,2}\/[0-9]{2,4})\s*\n\s*Faktura/,
  ];
  for (const p of numPats) { const m = t.match(p) ?? flat.match(p); if (m) { number = m[1].replace(/[._-]+$/, ''); break; } }
  if (!number) return null;
  // стороны
  let seller_nip: string | null = null, buyer_nip: string | null = null;
  const sm = t.match(/Sprzedawca[\s\S]{0,40}?\n/i);
  if (isNota) { seller_nip = nipOf(flat.match(/Wystawca[\s\S]{0,200}?NIP:?\s*(?:PL)?\s*([\d -]{10,14})/i)?.[1] ?? '') || null; buyer_nip = nipOf(flat.match(/Odbiorca[\s\S]{0,200}?NIP:?\s*(?:PL)?\s*([\d -]{10,14})/i)?.[1] ?? '') || null; }
  else if (ns.length >= 2) {
    // в двухколоночном макете порядок NIP «продавец, покупатель» сохраняется; KSeF: блок «Sprzedawca … NIP» тоже первым
    const pl = flat.match(/NIP:?\s*PL\s*(\d{10})/i)?.[1];
    if (pl && ns.includes(pl)) { buyer_nip = pl; seller_nip = ns.find((n) => n !== pl) ?? null; } // «PL» ставят только у набывцы (Scanye)
    else { seller_nip = ns[0]; buyer_nip = ns[1]; }
    // KSeF: «Prefiks VAT: PL NIP: <buyer>» идёт раньше NIP продавца
    const ks = flat.match(/Sprzedawca Nabywca Prefiks VAT: PL NIP: (\d{10}) NIP: (\d{10})/);
    if (ks) { buyer_nip = ks[1]; seller_nip = ks[2]; }
    // старый макет MTMC: «NIP:947-104-86-37 NIP: 9291744080» — продавец слева
  } else if (ns.length === 1) { seller_nip = ns[0]; issues.push('jeden NIP w dokumencie'); }
  void sm;
  const seller_name = sellerName(t, flat, isNota);
  // даты
  const d = (re: RegExp) => isoDate(flat.match(re)?.[1] ?? null);
  const issue_date = d(/(?:Faktura|Korekta)[a-ząćęłńóśźżA-Z ]{0,20} (?:nr|Nr) \S+ z dnia (\d{2}[.\-]\d{2}[.\-]\d{4})/) ?? d(/Data wystawienia[^:]*:\s*(\d{2}[.\-]\d{2}[.\-]\d{4})/i)
    ?? d(/(\d{2}-\d{2}-\d{4}) \d{2}-\d{2}-\d{4} data wystawienia/) ?? d(/(?:Warszawa|wystawienia),? (?:dn\.|dnia)?\s*(\d{2}\.\d{2}\.\d{4})/i) ?? d(/Miejsce i data wystawienia:[^,]*,\s*(\d{2}\.\d{2}\.\d{4})/);
  const sale_date = d(/Data sprzedaży:?\s*(\d{2}[.\-]\d{2}[.\-]\d{4})/i) ?? d(/\d{2}-\d{2}-\d{4} (\d{2}-\d{2}-\d{4}) data wystawienia/) ?? d(/wykonania usługi:? (?:Kod waluty: PLN )?(\d{2}\.\d{2}\.\d{4})/i);
  const due_date = d(/Przelew do dnia (\d{2}[.\-]\d{2}[.\-]\d{4})/i) ?? d(/Termin płatności:?\s*(\d{2}[.\-]\d{2}[.\-]\d{4})/i) ?? d(/Termin płatności (?:\S+ ){0,6}?(\d{2}\.\d{2}\.\d{4})/i) ?? d(/do dnia:?\s*(\d{2}\.\d{2}\.\d{4})/i);
  // суммы: строка «Razem net vat gross» (последняя согласованная тройка), иначе ставки KSeF
  let net: number | null = null, vat: number | null = null, gross: number | null = null;
  const triples: [number, number, number][] = [];
  for (const line of t.split('\n')) {
    if (!/razem|ogółem|23\s?%|23 lub 22%|suma/i.test(line)) continue;
    const a = amtAll(line);
    for (let i = 0; i + 2 < a.length; i++) if (Math.abs(r2(a[i] + a[i + 1]) - a[i + 2]) <= 0.011) triples.push([a[i], a[i + 1], a[i + 2]]);
  }
  // старый MTMC: «RAZEM 100 000,00 zł X 23 000,00 zł 123 000,00 zł»
  for (const m of flat.matchAll(new RegExp(`RAZEM (${AMT}) zł X (${AMT}) zł (${AMT}) zł`, 'g'))) triples.push([amount(m[1])!, amount(m[2])!, amount(m[3])!]);
  const razem = [...t.split('\n')].filter((l) => /^\s*Razem\b/i.test(l)).map(amtAll).filter((a) => a.length >= 3 && eq(r2(a[a.length - 3] + a[a.length - 2]), a[a.length - 1]));
  const pickT = razem.length ? razem[razem.length - 1].slice(-3) as [number, number, number] : triples.length ? triples[triples.length - 1] : null;
  if (pickT) [net, vat, gross] = pickT;
  const ogolem = amount(flat.match(new RegExp(`Kwota należności ogółem:? (${AMT})`))?.[1]);
  if (gross === null && ogolem !== null) { gross = ogolem; issues.push('brutto tylko z „Kwota należności ogółem”'); }
  if (ogolem !== null && gross !== null && !eq(ogolem, gross)) issues.push(`„należność ogółem” ${ogolem} ≠ brutto ${gross}`);
  // к оплате / оплачено
  const to_pay = amount(flat.match(new RegExp(`Pozostało do zapłaty:? (${AMT})`))?.[1]) ?? amount(flat.match(new RegExp(`Podsumowanie faktury (?:Zapłacono Data zapłaty )?Pozostało do zapłaty (?:${AMT} PLN \\d{2}\\.\\d{2}\\.\\d{4} )?(${AMT})`))?.[1])
    ?? amount(flat.match(new RegExp(`Do zapłaty:? (${AMT})`, 'i'))?.[1]);
  let paid_in_doc = amount(flat.match(new RegExp(`Zapłacono:? (${AMT})`))?.[1]);
  let paid_date: string | null = null;
  const pz = flat.match(new RegExp(`Podsumowanie faktury Zapłacono Data zapłaty Pozostało do zapłaty (${AMT}) PLN (\\d{2}\\.\\d{2}\\.\\d{4})`));
  if (pz) { paid_in_doc = amount(pz[1]); paid_date = isoDate(pz[2]); }
  if (/Informacja o płatności: Zapłacono/i.test(flat)) paid_in_doc = gross;
  // связи
  // строки «Rozliczenie I transzy do zaliczki nr … − 30 750,00 FZ/01/07/2025»: часть суммы покрыта авансом, брутто счёта уже за вычетом
  const advance_used: { ref: string; gross: number }[] = [];
  for (const m of flat.matchAll(/Rozliczenie[^]*?(?=Stawka|\s\d+ Zam\.|\s\d+ Rozliczenie|$)/g)) {
    const seg = m[0];
    const ref = seg.match(/(?:nr\s*)?((?:FZ|ZAL)\s*\/\s*\d+\s*\/\s*\d+\s*\/\s*\d+)/i)?.[1];
    const negs = [...seg.matchAll(/-\s?(\d{1,3}(?: \d{3})*,\d{2})/g)].map((x) => amount(x[1])!);
    if (ref && negs.length) advance_used.push({ ref: ref.replace(/\s+/g, ''), gross: negs[negs.length - 1] });
  }
  const settles = advance_used.length ? [] : [...new Set([...flat.matchAll(/(?:Rozliczeniowa do zaliczki|rozliczenie zaliczki|do Faktury zaliczkowej|Otrzymane zaliczki[^]{0,80}?(?=ZAL|FZ))\s*(?:nr\s*)?((?:FZ|ZAL)[/._ -]*\d+[/._-]\d+[/._-]\d+)/gi)].map((m) => m[1].replace(/\s+/g, '')))];
  const corrects = isKor ? flat.match(/Do faktury nr (\S+)/i)?.[1] ?? flat.match(/korygowan\S* (?:faktury )?(?:nr )?(\S+)/i)?.[1] ?? null : null;
  const order_no = orderKey(flat);
  const tidy = (x: string | null) => x ? x.replace(/\s\d{1,2}\s1[.,]0{1,2}\s?szt\.?/g, ' ').replace(/\s1\s(?=\d{2}\.\d{2}\.\d{4})/g, ' ').replace(/\s1\s(?=[A-ZŁŚ"„])/g, ' ').replace(/\s+/g, ' ').trim() : x;
  const subject0 = clean(flat.match(/(Zam\.? ?nr GW[\s\S]{0,180}?)(?:\s+\d[\d ]*,\d{2}|\s+Stawka|\s+VAT|\s+Razem|$)/)?.[1]) ?? clean(flat.match(/(Zaliczka do zamówienia[\s\S]{0,160}?)(?:\s+\d[\d ]*,\d{2}|\s+1 1 )/)?.[1]);
  // нота: сумма переноса
  if (isNota) {
    gross = amount(flat.match(new RegExp(`Kwota przeniesienia:? (${AMT})`))?.[1]) ?? amount(flat.match(new RegExp(`wysokości (${AMT})`))?.[1]) ?? gross;
    net = null; vat = null;
  }
  // корректировка: дельта = после − до; если в документе нули, а корректируется зáлика целиком — дельта = −её сумма (решается при сверке)
  let kind: Kind | 'nota' = isNota ? 'nota' : isKor ? 'korekta' : (isRozl && !advance_used.length) || settles.length ? 'rozliczeniowa' : isZal ? 'zaliczkowa' : 'faktura';
  if (kind === 'faktura' && /^(ZAL|FZ)/i.test(number)) kind = 'zaliczkowa';
  if (kind === 'faktura' && /^FVR/i.test(number)) kind = 'rozliczeniowa';
  if (kind === 'korekta') {
    const przed = amtAll(flat.match(/Przed[\s\S]{0,120}?(?=Po )/)?.[0] ?? '');
    const po = amtAll(flat.match(/Po [\s\S]{0,120}?(?=Stawka|Razem)/)?.[0] ?? '');
    const pb = przed.length ? przed[przed.length - 1] : null; const pa = po.length ? po[po.length - 1] : null;
    if (pb !== null && pa !== null && !(pb === 0 && pa === 0)) { gross = r2(pa - pb); net = null; vat = null; }
    else if (/Korekta zaliczki|anulowani|storn/i.test(flat)) { issues.push('korekta zaliczki do zera — kwota = −zaliczka'); net = gross !== null ? -Math.abs(net ?? 0) : null; vat = vat !== null ? -Math.abs(vat) : null; gross = gross !== null ? -Math.abs(gross) : null; }
  }
  let confidence = 1;
  if (!seller_nip) { confidence -= 0.4; issues.push('brak NIP sprzedawcy'); }
  if (gross === null) { confidence -= 0.5; issues.push('brak kwoty brutto'); }
  if (kind !== 'nota' && kind !== 'korekta' && net !== null && vat !== null && gross !== null && !eq(r2(net + vat), gross)) { confidence -= 0.3; issues.push('netto + VAT ≠ brutto'); }
  if (!issue_date) { confidence -= 0.1; issues.push('brak daty wystawienia'); }
  return { kind, number, seller_nip, buyer_nip, seller_name, buyer_name: buyer_nip ? (clean(flat.match(/Nabywca:?\s*"?([^"\n]{0,4}CK COMPLEX"?[^\n]{0,30}?)(?:\s+Adres|\s+ul\.|\s+NIP)/i)?.[1]) ?? null) : null,
    issue_date, sale_date, due_date, net, vat, gross, to_pay, paid_in_doc, paid_date, settles, corrects, order_no, subject: tidy(subject0), confidence, issues, advance_used };
}

/** название продавца: разные макеты (Scanye, SaldeoSMART, KSeF, старый MTMC, нота) */
function sellerName(t: string, flat: string, nota: boolean): string | null {
  const bad = (s: string) => /CK COMPLEX|Prefiks|Miejsce|Nabywca|Odbiorca|Adres|^\W*$/i.test(s) || s.length < 3;
  const fix = (s: string | undefined) => { const c = clean(s?.replace(/\s+(ul\.|Adres).*$/i, '').replace(/^"|"$/g, '')); return c && !bad(c) ? c : null; };
  const cands: (string | undefined)[] = [];
  if (nota) cands.push(flat.match(/Wystawca:?\s*(.{3,60}?)\s+ul\./)?.[1]);
  cands.push(flat.match(/Sprzedawca:\s*(.{3,60}?)\s+Nabywca:/)?.[1]);                                        // SaldeoSMART
  cands.push(t.match(/Sprzedawca\s+Nabywca\s*\n\s*(.{3,80}?)\s+"?CK COMPLEX/i)?.[1]);                          // Scanye, первая строка — продавец
  const ks = flat.match(/NIP: \d{10} Nazwa: (.{3,60}?) (?:ODPOWIEDZIALNOŚCIĄ )?Adres/); if (ks) cands.push(ks[1]); // KSeF
  const ks2 = [...flat.matchAll(/Nazwa: (.{3,80}?)(?= Adres| ODPOWIEDZIALNOŚCIĄ| ul\.)/g)].map((m) => m[1]); cands.push(...ks2);
  cands.push(t.split('\n').map((l) => l.trim()).find((l) => l.length > 2));                                // старый MTMC: первая строка
  for (const c of cands) { const f = fix(c); if (f) return f.replace(/\s+SPÓŁKA Z OGRANICZONĄ$/i, ' SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ'); }
  return null;
}

// ───────────────────────── реестры (xlsx → текст «a | b | c») ─────────────────────────
/** CSV с разделителем « | » и кавычками RFC; многострочные ячейки в кавычках */
export function parseSheet(block: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < block.length; i++) {
    const c = block[i];
    if (q) { if (c === '"') { if (block[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; continue; }
    if (c === '"' && cur.trim() === '') { q = true; cur = ''; continue; }
    if (c === '|') { row.push(cur.trim()); cur = ''; continue; }
    if (c === '\n') { row.push(cur.trim()); rows.push(row); row = []; cur = ''; continue; }
    cur += c;
  }
  row.push(cur.trim()); rows.push(row);
  return rows.filter((r) => r.some((x) => x));
}

/** текст документа из кусков: внутри одного листа куски склеиваются пробелом (так их резал chunkText) */
export function joinChunks(chunks: string[]): string {
  // chunkText резал длинный лист по последнему пробельному символу до 1800 — это мог быть пробел или перевод строки.
  // Выбираем: если при склейке пробелом строка получает больше ячеек, чем любая целая строка этого листа, — это был перевод строки.
  const cells = (s: string) => { let n = 1, q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '"') q = !q; else if (c === '|' && !q) n++; } return n; };
  // проход 1: ширина каждого листа по его целым строкам (первая и последняя строка куска могут быть обрезаны)
  const widths: number[] = []; let sheet = -1; const sheetAtEnd: number[] = [];
  chunks.forEach((c, ci) => {
    const lines = c.split('\n');
    lines.forEach((l, li) => {
      if (/^\[Arkusz:/.test(l)) { sheet++; widths[sheet] = 0; return; }
      if (li > 0 && li < lines.length - 1 && sheet >= 0) widths[sheet] = Math.max(widths[sheet], cells(l));
    });
    sheetAtEnd[ci] = sheet;
  });
  // проход 2: склейка
  let out = '';
  chunks.forEach((c, i) => {
    if (i === 0) { out = c; return; }
    if (/^\[Arkusz:/.test(c)) { out += '\n\n' + c; return; }
    const w = widths[sheetAtEnd[i - 1]] ?? 0;
    const tail = out.slice(out.lastIndexOf('\n') + 1);
    const head = c.split('\n')[0];
    out += (w > 2 && cells(`${tail} ${head}`) > w && cells(tail) > 1 && cells(head) > 1 ? '\n' : ' ') + c;
  });
  return out;
}

const COLS: [keyof RegRow, RegExp][] = [
  ['seller', /^(podmiot|wystawca|sprzedawca|firma)$/],
  ['kind', /^(rodzaj[_ ]?(faktury|dokumentu)?|typ)$/],
  ['number', /^(nr faktury|numer dokumentu|numer faktury|nr dokumentu|nr faktury zaliczkowej)$/],
  ['date', /^(data faktury|data dokumentu|data wystawienia|data zaliczki)$/],
  ['buyer', /^(klient|nabywca|kontrahent)$/],
  ['net', /^kwota netto$/], ['vat', /^vat$/], ['gross', /^kwota brutto$/],
  ['paid', /^(wpłacono|zapłacono)$/], ['open', /^(kwota do zapłaty|pozostaje do zapłaty|do zapłaty)$/],
  ['due', /^(data_terminpłatności|termin płatności|termin)$/], ['paid_date', /^(data_zapłaty|data zapłaty|data zapłaty zaliczki)$/],
  ['title', /^(tytuł|tytuł faktury)$/], ['order', /^(zamówienie|zamowienie|nr zamówienia)$/], ['project', /^projekt$/], ['stage', /^etap$/],
  ['status', /^(status|status płatności|status rozliczenia)$/],
];
export interface RegRow {
  seller?: string; kind?: string; number?: string; date?: string; buyer?: string; net?: string; vat?: string; gross?: string; paid?: string; open?: string;
  due?: string; paid_date?: string; title?: string; order?: string; project?: string; stage?: string; status?: string;
}
export interface RegSheet { doc_id: string; title: string; sheet: string; asof: string | null; rows: RegRow[]; openOnly: boolean }

export function parseRegistry(doc: SrcDoc): RegSheet[] {
  const out: RegSheet[] = [];
  const blocks = doc.text.split(/\n\n(?=\[Arkusz: )/);
  for (const b of blocks) {
    const name = b.match(/^\[Arkusz: ([^\]\n]*)\]/)?.[1] ?? '';
    const rows = parseSheet(b.replace(/^\[Arkusz: [^\]\n]*\]\n?/, ''));
    let map: Partial<Record<keyof RegRow, number>> | null = null; let sheet: RegSheet | null = null;
    const pre: string[] = [];
    for (const r of rows) {
      const low = r.map((x) => x.toLowerCase().replace(/\s+/g, ' ').trim());
      const ni = low.findIndex((x) => COLS[2][1].test(x));
      if (ni >= 0 && low.some((x) => /kwota brutto|kwota netto|wpłacono|zapłacono/.test(x))) {
        map = {};
        low.forEach((h, i) => { for (const [k, re] of COLS) if (re.test(h) && map![k] === undefined) map![k] = i; });
        const isUS = true; void isUS;
        sheet = { doc_id: doc.id, title: doc.title, sheet: name, asof: null, rows: [], openOnly: /należno/i.test(name) };
        // дата среза: дата в строках над заголовком (например «11/17/26» рядом с «suma:»)
        for (const p of pre) for (const cell of p.split('\u0001')) { const dd = isoDate(cell, true); if (dd && (!sheet.asof || dd > sheet.asof)) sheet.asof = dd; }
        out.push(sheet); continue;
      }
      if (!map || !sheet) { pre.push(r.join('\u0001')); if (pre.length > 6) pre.shift(); continue; }
      const rr: RegRow = {};
      for (const [k, i] of Object.entries(map)) if (i !== undefined && r[i] !== undefined && r[i] !== '') (rr as any)[k] = r[i];
      if (!rr.number || !/\d/.test(rr.number) || /suma|razem/i.test(rr.number)) { if (rows.indexOf(r) >= 0) pre.push(r.join('\u0001')); continue; }
      sheet.rows.push(rr);
    }
  }
  // дата среза: максимум из дат оплаты/выставления, если явной даты нет
  for (const s of out) {
    let mx: string | null = null;
    for (const r of s.rows) for (const v of [r.date, r.paid_date]) { const dd = isoDate(v ?? null, true); if (dd && (!mx || dd > mx)) mx = dd; }
    if (!s.asof || (mx && mx > s.asof)) s.asof = s.asof ?? mx;
  }
  return out.filter((s) => s.rows.length);
}

// ───────────────────────── заказы (стоимость заказа и бюджет 2026) ─────────────────────────
export function parseOrders(doc: SrcDoc): { order_no: string; subject: string | null; date: string | null; seller: string | null; value: number; col: string; budget: boolean; title: string; sheet: string }[] {
  const out: ReturnType<typeof parseOrders> = [];
  for (const b of doc.text.split(/\n\n(?=\[Arkusz: )/)) {
    const sheet = b.match(/^\[Arkusz: ([^\]\n]*)\]/)?.[1] ?? '';
    let h: { order: number; value: number; vcol: string; budget: boolean; date: number; subj: number; seller: number } | null = null;
    for (const r of parseSheet(b.replace(/^\[Arkusz: [^\]\n]*\]\n?/, ''))) {
      const low = r.map((x) => x.toLowerCase().replace(/\s+/g, ' ').trim());
      const oi = low.findIndex((x) => /^(nr zamówienia|zamówienie|numer zamówienia)$/.test(x));
      if (oi >= 0) {
        const vi = low.findIndex((x) => /^(wartość zam[óo]w?enia\.? netto|wartość netto \(pln\)|budzet zamówienia|wartość zamówienia)$/.test(x)); const budget = false;
        h = vi >= 0 ? { order: oi, value: vi, vcol: r[vi], budget, date: low.findIndex((x) => /^data zamówienia$/.test(x)), subj: low.findIndex((x) => /^przedmiot zamówienia$/.test(x)), seller: low.findIndex((x) => /^(wykonawca|podmiot)$/.test(x)) } : null;
        continue;
      }
      if (!h) continue;
      const on = orderKey(r[h.order]); const v = amount(r[h.value]);
      if (!on || v === null || v <= 0) continue;
      out.push({ order_no: on, subject: h.subj >= 0 ? clean(r[h.subj]) : null, date: h.date >= 0 ? isoDate(r[h.date], true) : null, seller: h.seller >= 0 ? clean(r[h.seller]) : null, value: v, col: h.vcol, budget: h.budget, title: doc.title, sheet });
    }
  }
  return out;
}

// ───────────────────────── сборка реестра ─────────────────────────
export interface BuildOptions { home?: { nip: string; name: string; code: string }[]; today?: string }

export function buildLedger(docs: SrcDoc[], opts: BuildOptions = {}): Ledger {
  const ledger: Ledger = { built_at: new Date().toISOString(), parties: [], invoices: [], payments: [], allocations: [], orders: [], sources: [], checks: [] };
  const parsed: { doc: SrcDoc; p: ParsedInvoice }[] = [];
  const sheets: RegSheet[] = [];
  const orderRows: (ReturnType<typeof parseOrders>[number] & { created: string })[] = [];
  for (const doc of docs) {
    const isSheet = /^(xlsx|xls|xlsm|csv|ods)$/i.test(doc.ext ?? '') || /^\[Arkusz: /.test(doc.text);
    if (isSheet) orderRows.push(...parseOrders(doc).map((o) => ({ ...o, created: doc.created_at ?? '' })));
    if (isSheet) { const ss = parseRegistry(doc); if (ss.length) { sheets.push(...ss); ledger.sources.push({ id: doc.id, title: doc.title, kind: 'registry', asof: ss.map((s) => s.asof).filter(Boolean).sort().pop() ?? null, rows: ss.reduce((a, s) => a + s.rows.length, 0) }); } continue; }
    const pay = parsePayment(doc.title, doc.text);
    if (pay) { ledger.payments.push({ doc_id: doc.id, title: doc.title, ...pay, matched: null }); ledger.sources.push({ id: doc.id, title: doc.title, kind: 'payment' }); continue; }
    if (doc.text.length > 12000) continue; // переписка/отчёты с цитатами счетов — не первоисточник
    const p = parseInvoice(doc.title, doc.text);
    if (!p) continue;
    // письмо с вложенным счётом без таблицы сумм — пропускаем, если нет суммы или NIP
    if (p.confidence < 0.5) { ledger.sources.push({ id: doc.id, title: doc.title, kind: 'skipped', note: p.issues.join('; ') }); continue; }
    parsed.push({ doc, p });
  }

  // стороны: «свой» клиент = NIP, который чаще всего стоит покупателем
  const buyerCount = new Map<string, number>();
  for (const { p } of parsed) if (p.buyer_nip) buyerCount.set(p.buyer_nip, (buyerCount.get(p.buyer_nip) ?? 0) + 1);
  const client = [...buyerCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  for (const x of parsed) if (x.p.seller_nip === client && x.p.buyer_nip && x.p.buyer_nip !== client) [x.p.seller_nip, x.p.buyer_nip] = [x.p.buyer_nip, x.p.seller_nip];
  const parties = new Map<string, Party>();
  const nameVotes = new Map<string, Map<string, number>>();
  const addParty = (nip: string, name: string | null, role: Party['role']) => {
    const p = parties.get(nip) ?? { nip, name: nip, code: '', aliases: [], role };
    if (name) { if (!p.aliases.includes(name)) p.aliases.push(name); const v = nameVotes.get(nip) ?? new Map(); v.set(name, (v.get(name) ?? 0) + 1); nameVotes.set(nip, v); }
    parties.set(nip, p);
  };
  for (const { p } of parsed) { if (p.seller_nip) addParty(p.seller_nip, p.seller_name, 'seller'); if (p.buyer_nip) addParty(p.buyer_nip, p.buyer_name ?? (p.buyer_nip === client ? 'CK COMPLEX Sp. z o.o.' : null), 'buyer'); }
  for (const [nip, v] of nameVotes) { const best = [...v.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]; if (best) parties.get(nip)!.name = best[0]; }
  for (const h of opts.home ?? []) { const p = parties.get(h.nip); if (p) { p.code = h.code; p.name = h.name; } }
  for (const p of parties.values()) if (!p.code) p.code = codeOf(p.name);

  // ── 1. склейка копий одного счёта (ключ = NIP продавца + канонический номер)
  const inv = new Map<string, Invoice>();
  const blank = (o: Partial<Invoice>): Invoice => ({
    key: '', seller_nip: '', seller: '', seller_code: '', buyer_nip: client, buyer: client ? parties.get(client)?.name ?? null : null, number: '', number_key: '', kind: 'faktura',
    issue_date: null, sale_date: null, due_date: null, net: null, vat: null, gross: null, value_net: null, value_gross: null, advance_used: [], advance_left: null, counted: true,
    settles: [], corrects: null, order_no: null, subject: null, project: null, stage: null, paid: null, open: null, paid_date: null,
    pay_status: 'brak danych', pay_source: null, pay_asof: null, doc_ids: [], doc_titles: [], main_doc: null, in_registry: false, observations: [], issues: [], ...o });
  for (const { doc, p } of parsed.sort((a, b) => b.p.confidence - a.p.confidence)) {
    if (p.kind === 'nota') {
      const f = clean(doc.text)!;
      const dup = ledger.allocations.find((a) => a.seller_nip === p.seller_nip && numberKey(a.number, 'nota') === numberKey(p.number, 'nota'));
      ledger.sources.push({ id: doc.id, title: doc.title, kind: 'note', ...(dup ? { note: `kopia noty ${dup.number}` } : {}) });
      if (dup) continue;
      ledger.allocations.push({ doc_id: doc.id, title: doc.title, number: p.number, date: p.issue_date, seller_nip: p.seller_nip, amount: p.gross ?? 0,
        from_order: orderKey(f.match(/z zamówienia nr (.{0,30}?) z dnia/i)?.[1]), to_order: orderKey(f.match(/na poczet[\s\S]{0,80}?(GW\S+)/i)?.[1]), text: f.slice(0, 400) });
      continue;
    }
    const nk = numberKey(p.number, p.kind);
    const key = `${p.seller_nip}#${nk}`;
    const ex = inv.get(key);
    ledger.sources.push({ id: doc.id, title: doc.title, kind: 'invoice', ...(ex ? { note: `kopia ${ex.number}` } : {}) });
    if (ex) {
      ex.doc_ids.push(doc.id); ex.doc_titles.push(doc.title);
      if (p.gross !== null && ex.gross !== null && !eq(p.gross, ex.gross)) ex.issues.push(`kopia „${doc.title}” ma brutto ${p.gross}, a „${ex.doc_titles[0]}” ${ex.gross}`);
      continue;
    }
    const party = parties.get(p.seller_nip ?? '');
    inv.set(key, blank({
      key, seller_nip: p.seller_nip ?? '', seller: party?.name ?? p.seller_name ?? '', seller_code: party?.code ?? '', buyer_nip: p.buyer_nip, buyer: p.buyer_nip ? parties.get(p.buyer_nip)?.name ?? null : null,
      number: p.number, number_key: nk, kind: p.kind as Kind, issue_date: p.issue_date, sale_date: p.sale_date, due_date: p.due_date,
      net: p.net, vat: p.vat, gross: p.gross, advance_used: p.advance_used.map((a) => ({ ref: numberKey(a.ref, 'zaliczkowa'), gross: a.gross })),
      settles: p.settles.map((s) => numberKey(s, 'zaliczkowa')), corrects: p.corrects ? numberKey(p.corrects) : null, order_no: p.order_no, subject: p.subject,
      paid: p.paid_in_doc, open: p.to_pay, paid_date: p.paid_date, doc_ids: [doc.id], doc_titles: [doc.title], main_doc: doc.id,
      // «Zapłacono X, data zapłaty D» в самом счёте — факт оплаты (Scanye/Saldeo печатают его по банку)
      observations: p.paid_in_doc && p.paid_in_doc > 0 ? [{ source: doc.title, source_id: doc.id, asof: p.paid_date ?? p.issue_date, gross: p.gross, paid: p.paid_in_doc, open: p.to_pay, paid_date: p.paid_date, status: 'adnotacja na fakturze' }]
        : p.to_pay !== null ? [{ source: `${doc.title} (stan na dzień wystawienia)`, source_id: doc.id, asof: p.issue_date, gross: p.gross, paid: 0, open: p.to_pay, paid_date: null, status: 'stan na dzień wystawienia' }] : [],
      issues: [...p.issues],
    }));
  }

  // ── 2. реестры фирмы: строка ↔ счёт (продавец по алиасу/коду, номер; запасной путь — продавец + сумма + дата)
  const aliasNip = new Map<string, string>();
  const normName = (s: string) => s.toUpperCase().replace(/["„”]/g, '').replace(/SP(ÓŁKA|\.)?\s*Z\s*O(GRANICZONĄ)?\.?\s*O(DPOWIEDZIALNOŚCIĄ)?\.?/g, '').replace(/\s+/g, ' ').trim();
  for (const p of parties.values()) { aliasNip.set(normName(p.name), p.nip); for (const a of p.aliases) aliasNip.set(normName(a), p.nip); if (p.code) aliasNip.set(p.code, p.nip); }
  const core = (nk: string) => nk.replace(/^[A-Z]*\|/, '|');
  const resolveSeller = (name: string | undefined, nk: string, gross: number | null): string | null => {
    if (name) {
      const n = normName(name);
      if (aliasNip.has(n)) return aliasNip.get(n)!;
      for (const [a, nip] of aliasNip) if (a.length > 3 && n.length > 3 && (n.includes(a) || a.includes(n))) return nip;
    }
    const cands = [...inv.values()].filter((i) => core(i.number_key) === core(nk) && (gross === null || eq(Math.abs(i.gross ?? NaN), Math.abs(gross))));
    if (cands.length === 1) { if (name) aliasNip.set(normName(name), cands[0].seller_nip); return cands[0].seller_nip; }
    return null;
  };
  const NUM_OK = /^(?:[A-Z]{1,4}[\s/._-]*)?\d{1,4}[/._-]\d{1,2}[/._-]?\d{1,4}(?:[_/]\d{1,2})?$/i;
  const rows = sheets.flatMap((s) => s.rows.map((r) => ({ s, r }))).filter(({ r }) => NUM_OK.test(String(r.number).trim()) && (amount(r.gross) !== null || amount(r.net) !== null) && !/nota/i.test(r.kind ?? ''));
  for (let pass = 0; pass < 2; pass++) for (const { r } of rows) resolveSeller(r.seller, numberKey(r.number!, regKind(r.kind)), amount(r.gross));
  for (const { s, r } of rows) {
    const kind = regKind(r.kind) ?? (/^(ZAL|FZ)/i.test(r.number!) ? 'zaliczkowa' : /^KOR/i.test(r.number!) ? 'korekta' : /^FVR/i.test(r.number!) ? 'rozliczeniowa' : 'faktura');
    let nk = numberKey(r.number!, kind);
    const gross = amount(r.gross); const date = isoDate(r.date, true);
    const nip = resolveSeller(r.seller, nk, gross);
    let i = inv.get(`${nip}#${nk}`);
    if (!i && nip && gross !== null) {
      // номер в реестре с опечаткой («ZAL/26/021») — тот же продавец, та же сумма, дата ±3 дня, единственный кандидат
      const near = [...inv.values()].filter((x) => x.seller_nip === nip && eq(x.gross, gross) && x.issue_date && date && Math.abs(Date.parse(x.issue_date) - Date.parse(date)) <= 3 * 864e5 && !x.observations.some((o) => o.source_id === s.doc_id && o.sheet === s.sheet));
      if (near.length === 1) { i = near[0]; if (core(i.number_key) !== core(nk)) i.issues.push(`w „${s.title}” numer zapisany jako „${r.number}”`); nk = i.number_key; }
    }
    if (!i) {
      const key = `${nip ?? `?${normName(r.seller ?? '')}`}#${nk}`;
      i = inv.get(key);
      if (!i) {
        const party = nip ? parties.get(nip) : undefined;
        i = blank({ key, seller_nip: nip ?? '', seller: party?.name ?? r.seller ?? '?', seller_code: party?.code ?? codeOf(r.seller ?? ''), number: r.number!, number_key: nk, kind,
          issue_date: date, due_date: isoDate(r.due, true), net: amount(r.net), vat: amount(r.vat), gross, order_no: orderKey(r.order) ?? orderKey(r.title), subject: clean(r.title),
          issues: ['brak pliku faktury w bazie — kwota tylko z zestawienia'] });
        inv.set(key, i);
      }
    }
    i.in_registry = true;
    if (!i.project && r.project) i.project = clean(r.project);
    if (!i.stage && r.stage) i.stage = clean(r.stage);
    if (!i.order_no) i.order_no = orderKey(r.order) ?? orderKey(r.title);
    if (r.title && (!i.subject || !(i as any)._regTitle)) { i.subject = clean(r.title); (i as any)._regTitle = true; } // название из реестра фирмы чище, чем из таблицы PDF
    const st = clean(r.status) ?? (/korekt|korket/i.test(r.paid_date ?? '') ? 'korekta' : null);
    i.observations.push({ source: s.title, source_id: s.doc_id, sheet: s.sheet, asof: s.asof, gross, paid: amount(r.paid), open: amount(r.open), paid_date: isoDate(r.paid_date, true), status: st });
    if (gross !== null && i.gross !== null && !eq(Math.abs(gross), Math.abs(i.gross)) && i.doc_ids.length) i.issues.push(`„${s.title}” (${s.sheet}): brutto ${gross} ≠ faktura ${i.gross}`);
  }

  // ── 3. банковские подтверждения: сначала номер из названия файла, потом из текста
  for (const pay of ledger.payments) {
    const tryRefs = (refs: string[]) => [...inv.values()].filter((i) => refs.some((r) => { const k = numberKey(r); return core(k) === core(i.number_key) && (k.split('|')[0] === i.number_key.split('|')[0]); }) && eq(i.gross, pay.amount, 1));
    const titleRefs = pay.refs.filter((r) => pay.title.toUpperCase().replace(/[._ -]/g, '/').includes(r.toUpperCase().replace(/[._ -]/g, '/').replace(/^NR/, '')));
    let cands = tryRefs(titleRefs.length ? titleRefs : pay.refs);
    if (!cands.length && titleRefs.length) cands = tryRefs(pay.refs);
    const hit = cands.length === 1 ? cands[0] : undefined;
    if (hit) {
      pay.matched = hit.key;
      hit.observations.push({ source: pay.title, source_id: pay.doc_id, asof: pay.date, gross: pay.amount, paid: pay.amount, open: r2((hit.gross ?? 0) - pay.amount), paid_date: pay.date, status: 'potwierdzenie przelewu' });
      if (titleRefs.length && !pay.refs.every((r) => titleRefs.includes(r))) hit.issues.push(`w tytule przelewu „${pay.title}” wpisano inny numer (${pay.refs.filter((r) => !titleRefs.includes(r)).join(', ')})`);
    } else ledger.checks.push({ level: 'warn', code: 'payment_unmatched', msg: `Potwierdzenie przelewu „${pay.title}” (${pay.amount} zł${pay.date ? `, ${pay.date}` : ''}) nie pasuje jednoznacznie do żadnej faktury` });
  }

  const all = [...inv.values()];

  // ── 4. статус оплаты: побеждает самый свежий срез; список «należności» без счёта = счёт там не числится
  const openLists = sheets.filter((s) => s.openOnly && s.asof);
  for (const i of all) {
    const obs = [...i.observations].sort((a, b) => (a.asof ?? '').localeCompare(b.asof ?? '') || (a.status === 'potwierdzenie przelewu' ? 1 : 0) - (b.status === 'potwierdzenie przelewu' ? 1 : 0));
    let last = obs.filter((o) => o.paid !== null || o.open !== null).pop() ?? null;
    // свежий список należności того же продавца, где этого счёта нет
    const lastAsof = last?.asof ?? '';
    const newerList = openLists.filter((s) => (s.asof ?? '') > lastAsof && (i.issue_date ?? '9999') <= (s.asof ?? '') && s.rows.some((r) => resolveSeller(r.seller, numberKey(r.number!), amount(r.gross)) === i.seller_nip) && !i.observations.some((o) => o.source_id === s.doc_id && o.sheet === s.sheet))
      .sort((a, b) => (a.asof ?? '').localeCompare(b.asof ?? '')).pop();
    if (last) { i.paid = last.paid; i.open = last.open; i.paid_date = last.paid_date ?? i.paid_date; i.pay_source = last.source + (last.sheet ? ` / ${last.sheet}` : ''); i.pay_asof = last.asof; }
    if (newerList && last && (last.open ?? 0) > 0.01) {
      i.issues.push(`w starszym zestawieniu (${last.source}, ${last.asof}) do zapłaty ${last.open} zł, a na nowszej liście należności „${newerList.title} / ${newerList.sheet}” (stan na ${newerList.asof}) tej faktury już nie ma — prawdopodobnie zapłacona, brak potwierdzenia`);
      (i as any)._absent = newerList;
    }
    const opens = [...new Set(obs.filter((o) => o.open !== null && o.status !== 'potwierdzenie przelewu').map((o) => o.open))];
    if (opens.length > 1 && last && !(i.kind === 'rozliczeniowa' || i.advance_used.length || i.settles.length)) i.issues.push(`zestawienia różnią się co do kwoty do zapłaty (${opens.join(' / ')}); przyjęto najnowsze: ${i.pay_source}${i.pay_asof ? ` (stan na ${i.pay_asof})` : ''}`);
    const bank = obs.find((o) => o.status === 'potwierdzenie przelewu');
    if (bank && last && last !== bank && (last.open ?? 0) > 0.01) i.issues.push(`jest potwierdzenie przelewu z ${bank.asof} na ${bank.paid} zł, a nowsze zestawienie (${last.source}, ${last.asof}) pokazuje ${last.open} zł do zapłaty`);
    void last;
  }

  // ── 5. экономика: аванс — предоплата; rozliczeniowa и вычеты в счетах расходуют аванс; нота только переносит деньги
  const byKey = (seller: string, nk: string) => all.find((x) => x.seller_nip === seller && x.number_key === nk);
  for (const z of all) if (z.kind === 'zaliczkowa') z.advance_left = z.gross;
  for (const i of [...all].sort((a, b) => (a.issue_date ?? '').localeCompare(b.issue_date ?? ''))) {
    i.value_gross = i.gross; i.value_net = i.net;
    for (const u of i.advance_used) {
      const z = byKey(i.seller_nip, u.ref);
      if (!z) { i.issues.push(`odliczona zaliczka ${u.ref.replace(/\|/g, '/')} nie znaleziona`); continue; }
      if ((z.advance_left ?? 0) + 0.01 < u.gross) i.issues.push(`odliczenie ${u.gross} zł z zaliczki ${z.number}, a zostało z niej tylko ${z.advance_left} zł`);
      z.advance_left = r2((z.advance_left ?? 0) - u.gross);
    }
    if (i.kind === 'rozliczeniowa') {
      let covered = 0; let coveredNet = 0;
      for (const s of i.settles) {
        const z = byKey(i.seller_nip, s);
        if (!z) { i.issues.push(`zaliczka ${s.replace(/\|/g, '/')} nie znaleziona`); continue; }
        const c = Math.min(Math.max(z.advance_left ?? 0, 0), r2((i.gross ?? 0) - covered));
        if (c + 0.01 < (z.advance_left ?? 0) && c + 0.01 < (i.gross ?? 0)) i.issues.push(`zaliczka ${z.number} pokryła tylko ${c} zł`);
        if ((z.advance_left ?? 0) < 0.01) i.issues.push(`rozlicza zaliczkę ${z.number}, która była już wcześniej w całości rozliczona`);
        covered = r2(covered + c); coveredNet = r2(coveredNet + (z.gross ? c * (z.net ?? 0) / z.gross : 0));
        z.advance_left = r2((z.advance_left ?? 0) - c);
        i.advance_used.push({ ref: z.number_key, gross: c });
      }
      i.value_gross = r2((i.gross ?? 0) - covered); i.value_net = i.net !== null ? r2(i.net - coveredNet) : null;
    }
    if (i.kind === 'korekta') {
      const base = i.corrects ? byKey(i.seller_nip, i.corrects) ?? all.find((x) => x.seller_nip === i.seller_nip && core(x.number_key) === core(i.corrects!)) : undefined;
      if (base) { base.issues.push(`skorygowana korektą ${i.number} (${i.gross} zł)`); (base as any)._corrected = i; if (base.kind === 'zaliczkowa' && base.advance_left !== null) base.advance_left = r2(base.advance_left + (i.gross ?? 0)); }
      else if (i.corrects) i.issues.push(`korygowana faktura ${i.corrects.replace(/\|/g, '/')} nie znaleziona`);
    }
  }
  // ноты: переносят остаток аванса на другой заказ; если остатка нет — та же сумма использована дважды
  for (const a of ledger.allocations) {
    const zs = all.filter((z) => z.kind === 'zaliczkowa' && z.seller_nip === a.seller_nip && (!a.from_order || z.order_no === a.from_order));
    const left = r2(zs.reduce((x, z) => x + Math.max(z.advance_left ?? 0, 0), 0));
    const msg = `Nota ${a.number} („${a.title}”): przeniesienie ${a.amount} zł${a.from_order ? ` z ${a.from_order}` : ''}${a.to_order ? ` na ${a.to_order}` : ''} — to nie sprzedaż, nie dodaje się do sum`;
    if (zs.length && left + 0.01 < a.amount) {
      const users = all.filter((i) => i.advance_used.some((u) => zs.some((z) => z.number_key === u.ref))).map((i) => `${i.number} (${i.advance_used.filter((u) => zs.some((z) => z.number_key === u.ref)).reduce((x, u) => x + u.gross, 0)} zł)`);
      const fvr = all.filter((i) => i.kind === 'rozliczeniowa' && i.advance_used.some((u) => zs.some((z) => z.number_key === u.ref))).map((i) => i.number);
      ledger.checks.push({ level: 'error', code: 'allocation_conflict', msg: `${msg}. Jednocześnie zaliczka ${zs.map((z) => z.number).join(', ')} (${zs.reduce((x, z) => x + (z.gross ?? 0), 0)} zł) jest w całości rozliczona: ${users.join(', ')}. Te same pieniądze występują dwa razy — jako rozliczenie${fvr.length ? ` (${fvr.join(', ')})` : ''} i jako przeniesienie notą. W sumach liczone raz${fvr.length ? ` (${fvr.join(', ')} = 0 zł)` : ''}; księgowo do wyjaśnienia: zostaje albo faktura rozliczeniowa, albo nota.` });
      for (const z of zs) z.issues.push(`nota ${a.number} przenosi ${a.amount} zł, a z zaliczki zostało ${left} zł`);
    } else {
      for (const z of zs) z.advance_left = r2((z.advance_left ?? 0) - a.amount * ((z.advance_left ?? 0) / (left || 1)));
      ledger.checks.push({ level: 'info', code: 'allocation', msg });
    }
  }

  // ── 6. итоговый статус и «считать ли в суммах»
  const cover = new Map<string, [string, string]>();
  for (const s of sheets) for (const r of s.rows) { const d = isoDate(r.date, true); if (!d) continue; const c = cover.get('*') ?? [d, d]; cover.set('*', [d < c[0] ? d : c[0], d > c[1] ? d : c[1]]); }
  const [cFrom, cTo] = cover.get('*') ?? ['', ''];
  for (const i of all) {
    const corr = (i as any)._corrected as Invoice | undefined;
    if (corr && i.gross !== null && eq(r2(i.gross + (corr.gross ?? 0)), 0)) { i.pay_status = 'skorygowana'; i.open = 0; }
    else if (i.kind === 'korekta') { i.pay_status = 'skorygowana'; i.open = 0; }
    else if (i.kind === 'rozliczeniowa' && eq(i.value_gross, 0)) { i.pay_status = 'rozliczona zaliczką'; i.open = 0; }
    else if (i.open === null && i.paid === null) i.pay_status = 'brak danych';
    else if ((i as any)._absent) { i.pay_status = 'brak danych'; i.open = null; i.paid = null; } // ostatnia znana kwota zostaje w observations
    else {
      const open = i.open ?? r2((i.value_gross ?? i.gross ?? 0) - (i.paid ?? 0));
      i.open = open;
      i.pay_status = open <= 0.01 ? 'zapłacona' : (i.paid ?? 0) > 0.01 ? 'częściowo' : 'niezapłacona';
    }
    // счёт есть только в письме/черновике, а в реестрах фирмы за этот период его нет — не считаем, показываем отдельно
    if (!i.in_registry && sheets.length && i.issue_date && i.issue_date >= cFrom && i.issue_date <= cTo) {
      const twin = all.find((x) => x !== i && x.in_registry && x.order_no && x.order_no === i.order_no && eq(x.gross, i.gross) && x.kind === i.kind);
      i.counted = false;
      i.issues.push(twin ? `nie ma w żadnym zestawieniu firmy; zastąpiona fakturą ${twin.seller_code} ${twin.number} (to samo zamówienie i kwota) — nie liczona` : 'nie ma w żadnym zestawieniu firmy za ten okres (projekt / anulowana?) — nie liczona do sum');
    }
    delete (i as any)._absent; delete (i as any)._corrected; delete (i as any)._regTitle;
  }

  for (const i of all) for (const msg of i.issues) ledger.checks.push({ level: /≠|różnią|nie znalezion|dwa razy|już wcześniej|a nowsze zestawienie|nie liczona|zostało z niej|prawdopodobnie/.test(msg) ? 'warn' : 'info', code: 'invoice', msg: `${i.seller_code || i.seller} ${i.number}: ${msg}`, key: i.key });

  // ── 7. заказы: стоимость заказа (самый свежий источник) и бюджет 2026; расхождения между источниками — в issues
  const om = new Map<string, Order>();
  for (const o of orderRows.sort((a, b) => a.created.localeCompare(b.created))) {
    const x = om.get(o.order_no) ?? { order_no: o.order_no, subject: null, date: null, seller: null, value_net: null, moved_in: 0, moved_out: 0, sources: [], issues: [] };
    if (o.subject && (!x.subject || o.subject.length > x.subject.length)) x.subject = o.subject.slice(0, 300);
    if (o.date) x.date = o.date; if (o.seller) x.seller = o.seller;
    if (!o.budget) { if (x.value_net !== null && !eq(x.value_net, o.value, 1)) x.issues.push(`wartość zamówienia: ${x.value_net} wg wcześniejszego źródła, ${o.value} wg „${o.title}” (${o.sheet})`); x.value_net = o.value; }
    if (!x.sources.some((s) => s.title === o.title && s.sheet === o.sheet && s.col === o.col)) x.sources.push({ title: o.title, sheet: o.sheet, col: o.col, value: o.value });
    om.set(o.order_no, x);
  }
  for (const i of all) if (i.order_no && !om.has(i.order_no)) om.set(i.order_no, { order_no: i.order_no, subject: i.subject, date: null, seller: null, value_net: null, moved_in: 0, moved_out: 0, sources: [], issues: ['brak wartości zamówienia w zestawieniach'] });
  for (const a of ledger.allocations) {
    const blankO = (n: string): Order => ({ order_no: n, subject: null, date: null, seller: null, value_net: null, moved_in: 0, moved_out: 0, sources: [], issues: [] });
    if (a.from_order) { const o = om.get(a.from_order) ?? blankO(a.from_order); o.moved_out = r2(o.moved_out + a.amount); om.set(a.from_order, o); }
    if (a.to_order) { const o = om.get(a.to_order) ?? blankO(a.to_order); o.moved_in = r2(o.moved_in + a.amount); om.set(a.to_order, o); }
  }
  ledger.orders = [...om.values()].sort((a, b) => a.order_no.localeCompare(b.order_no));

  ledger.parties = [...parties.values()];
  ledger.invoices = all.sort((a, b) => (a.issue_date ?? '').localeCompare(b.issue_date ?? '') || a.number.localeCompare(b.number));
  return ledger;
}

function regKind(s: string | undefined): Kind | undefined {
  if (!s) return undefined;
  if (/korekt/i.test(s)) return 'korekta';
  if (/zaliczk/i.test(s)) return 'zaliczkowa';
  if (/rozlicz|końcow/i.test(s)) return 'rozliczeniowa';
  if (/faktura|vat/i.test(s)) return 'faktura';
  return undefined;
}

function codeOf(name: string): string {
  const n = name.toUpperCase();
  if (/MTM/.test(n)) return 'MTMC';
  if (/INFINITIQ/.test(n)) return 'FIQ';
  if (/FASTLINE EVENTS|^FLE$/.test(n)) return 'FLE';
  if (/FASTLINE ADVERTISING/.test(n)) return 'FLA';
  if (/GREY ?WOLF/.test(n)) return 'GW';
  if (/CK COMPLEX/.test(n)) return 'CK';
  return n.replace(/["„”]/g, '').split(/\s+/).filter((w) => w.length > 2 && !/SP[ÓO]ŁKA|Z|O\.O\./.test(w)).slice(0, 2).map((w) => w[0]).join('') || n.slice(0, 4);
}

/** итоги по продавцам: «к оплате без дублей», оплачено, открыто (подтверждённо), неизвестно */
export function summarize(l: Ledger) {
  const by = new Map<string, { code: string; seller: string; invoices: number; value_net: number; value_gross: number; open: number; open_n: number; unknown: number; unknown_n: number; not_counted: number }>();
  for (const i of l.invoices) {
    const k = i.seller_code || i.seller;
    const s = by.get(k) ?? { code: i.seller_code, seller: i.seller, invoices: 0, value_net: 0, value_gross: 0, open: 0, open_n: 0, unknown: 0, unknown_n: 0, not_counted: 0 };
    if (!i.counted) { s.not_counted++; by.set(k, s); continue; }
    s.invoices++; s.value_gross = r2(s.value_gross + (i.value_gross ?? 0)); s.value_net = r2(s.value_net + (i.value_net ?? 0));
    if (i.pay_status === 'brak danych') { s.unknown = r2(s.unknown + (i.value_gross ?? 0)); s.unknown_n++; }
    else if ((i.open ?? 0) > 0.01) { s.open = r2(s.open + (i.open ?? 0)); s.open_n++; }
    by.set(k, s);
  }
  return [...by.values()].sort((a, b) => b.value_gross - a.value_gross);
}

/** сводка для карточки ИИ и экранов (всё уже посчитано движком — модель только читает) */
export function financeSummary(l: Ledger) {
  const c = l.invoices.filter((i) => i.counted);
  const sum = (arr: Invoice[], f: (i: Invoice) => number | null) => r2(arr.reduce((a, i) => a + (f(i) ?? 0), 0));
  const openInv = c.filter((i) => (i.pay_status === 'niezapłacona' || i.pay_status === 'częściowo') && (i.open ?? 0) > 0.01);
  const unknown = c.filter((i) => i.pay_status === 'brak danych');
  const bySrc = new Map<string, { source: string; asof: string | null; n: number; open: number; sellers: Set<string> }>();
  for (const i of openInv) {
    const onlyDoc = !i.pay_source || /\(stan na dzień wystawienia\)$/.test(i.pay_source);
    const k = onlyDoc ? 'doc' : `${i.pay_source}|${i.pay_asof}`;
    const s = bySrc.get(k) ?? { source: onlyDoc ? 'same faktury — brak nowszego zestawienia (stan na dzień wystawienia)' : i.pay_source!, asof: i.pay_asof, n: 0, open: 0, sellers: new Set() };
    s.n++; s.open = r2(s.open + (i.open ?? 0)); s.sellers.add(i.seller_code); if ((i.pay_asof ?? '') > (s.asof ?? '')) s.asof = i.pay_asof; bySrc.set(k, s);
  }
  const dates = c.map((i) => i.issue_date).filter(Boolean).sort() as string[];
  return {
    invoices: c.length, not_counted: l.invoices.length - c.length,
    period: [dates[0] ?? null, dates[dates.length - 1] ?? null],
    gross_on_documents: sum(c, (i) => i.gross), value_gross: sum(c, (i) => i.value_gross), value_net: sum(c, (i) => i.value_net),
    duplicates_removed: r2(sum(c, (i) => i.gross) - sum(c, (i) => i.value_gross)),
    duplicates: c.filter((i) => Math.abs((i.gross ?? 0) - (i.value_gross ?? 0)) > 0.01).map((i) => `${i.seller_code} ${i.number} ${i.gross} (${i.kind === 'korekta' ? 'korekta' : `pokryta zaliczką ${i.advance_used.map((u) => u.ref.split('|').slice(1).reverse().join('/')).join(', ')}`})`),
    open_confirmed: sum(openInv, (i) => i.open), open_count: openInv.length,
    open_by_source: [...bySrc.values()].map((s) => ({ source: s.source, asof: s.asof, invoices: s.n, open: s.open, sellers: [...s.sellers] })),
    unknown_gross: sum(unknown, (i) => i.value_gross), unknown_count: unknown.length,
    advance_left: sum(c.filter((i) => i.kind === 'zaliczkowa'), (i) => Math.max(i.advance_left ?? 0, 0)),
    sellers: summarize(l),
    by_year: (() => { // канонические итоги по годам — одинаковые в чате, дашбордах и экранах
      const m = new Map<string, { year: string; gross: number; net: number; invoices: number; sellers: Record<string, number> }>();
      for (const i of c) { const y = (i.issue_date ?? '????').slice(0, 4); const x = m.get(y) ?? { year: y, gross: 0, net: 0, invoices: 0, sellers: {} }; x.gross = r2(x.gross + (i.value_gross ?? 0)); x.net = r2(x.net + (i.value_net ?? 0)); x.invoices++; x.sellers[i.seller_code] = r2((x.sellers[i.seller_code] ?? 0) + (i.value_gross ?? 0)); m.set(y, x); }
      return [...m.values()].sort((a, b) => a.year.localeCompare(b.year));
    })(),
    registries: l.sources.filter((s) => s.kind === 'registry').map((s) => ({ title: s.title, asof: s.asof, rows: s.rows })),
    errors: l.checks.filter((x) => x.level === 'error').map((x) => x.msg),
    warnings: l.checks.filter((x) => x.level === 'warn').length,
  };
}

/** строки для таблиц Postgres (fin_replace) */
export function ledgerRows(l: Ledger) {
  return {
    invoices: l.invoices.map((i) => ({
      key: i.key, seller_nip: i.seller_nip || null, seller: i.seller, seller_code: i.seller_code, buyer_nip: i.buyer_nip, buyer: i.buyer, number: i.number, kind: i.kind,
      issue_date: i.issue_date, sale_date: i.sale_date, due_date: i.due_date, net: i.net, vat: i.vat, gross: i.gross, value_net: i.value_net, value_gross: i.value_gross,
      advance_used: i.advance_used.length ? r2(i.advance_used.reduce((a, u) => a + u.gross, 0)) : null, advance_left: i.advance_left,
      paid: i.paid, open: i.open, paid_date: i.paid_date, pay_status: i.pay_status, pay_source: i.pay_source, pay_asof: i.pay_asof, counted: i.counted, in_registry: i.in_registry,
      order_no: i.order_no, subject: i.subject, project: i.project, stage: i.stage, settles: i.settles.map((s) => s.split('|').slice(1).join('/')), corrects: i.corrects,
      doc_ids: i.doc_ids, doc_titles: i.doc_titles, main_doc: i.main_doc, observations: i.observations, issues: i.issues,
    })),
    parties: l.parties.map((p) => ({ nip: p.nip, code: p.code, name: p.name, role: p.role, aliases: p.aliases })),
    payments: l.payments.map((p) => ({ doc_id: p.doc_id, title: p.title, date: p.date, amount: p.amount, payer: p.payer, payee: p.payee, refs: p.refs, matched: p.matched })),
    allocations: l.allocations.map((a) => ({ doc_id: a.doc_id, title: a.title, number: a.number, date: a.date, seller_nip: a.seller_nip, amount: a.amount, from_order: a.from_order, to_order: a.to_order, text: a.text })),
    checks: l.checks.map((c) => ({ level: c.level, code: c.code, msg: c.msg, key: c.key ?? null })),
    orders: l.orders.map((o) => ({ order_no: o.order_no, subject: o.subject, date: o.date, seller: o.seller, value_net: o.value_net, moved_in: o.moved_in, moved_out: o.moved_out, sources: o.sources, issues: o.issues })),
    sources: l.sources,
  };
}
