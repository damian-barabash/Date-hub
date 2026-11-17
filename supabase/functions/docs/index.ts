// Разбор документов ИИ: вкладки меню (таксономия, максимум 15) и поля каждого документа
// (тип, дата, контрагент, номер, суммы, краткое содержание). Модель видит только начало и конец текста.
import { admin, cors, deepseek, json, parseJson, requireUser } from '../_shared/util.ts';

const MAX_CATEGORIES = 12; // с запасом до лимита меню в 15 вкладок
type Cat = { name: string; desc: string };

async function getTaxonomy(db: ReturnType<typeof admin>): Promise<Cat[]> {
  const { data } = await db.from('app_settings').select('value').eq('key', 'taxonomy').maybeSingle();
  return (data?.value?.categories ?? []) as Cat[];
}
const saveTaxonomy = (db: ReturnType<typeof admin>, categories: Cat[]) =>
  db.from('app_settings').upsert({ key: 'taxonomy', value: { categories }, updated_at: new Date().toISOString() });

/** Вкладки меню из структуры загруженного: папки + названия файлов → 4–12 понятных разделов. */
async function buildTaxonomy(db: ReturnType<typeof admin>) {
  const { data: docs } = await db.from('documents').select('title, path').limit(3000);
  const byPath = new Map<string, string[]>();
  for (const d of docs ?? []) { const k = d.path || '(bez folderu)'; byPath.set(k, [...(byPath.get(k) ?? []), d.title]); }
  const lines = [...byPath.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 140)
    .map(([p, t]) => `${p} — ${t.length} plików, np.: ${t.slice(0, 3).map((x) => x.slice(0, 60)).join('; ')}`);
  const prompt = `Poniżej struktura folderów i przykładowe pliki firmy (CK Complex — sieć sklepów z e-papierosami; dokumenty zarządcze).
Zaproponuj zakładki menu aplikacji dla dyrekcji: od 4 do ${MAX_CATEGORIES} kategorii, które razem pokrywają WSZYSTKIE dokumenty.
Zasady: nazwy po polsku, 1–3 słowa, zrozumiałe dla dyrektora (np. „Faktury i rozliczenia", „Zamówienia", „Audyt", „Kampanie", „Umowy", „Budżet", „Raporty"); kategorie rozłączne; nie twórz kategorii dla pojedynczych plików; bez kategorii „Inne", chyba że to konieczne (wtedy jedna).
Odpowiedz json: {"categories":[{"name":"…","desc":"co tu trafia, 1 zdanie"}]}

${lines.join('\n')}`;
  const r = await deepseek([{ role: 'user', content: prompt }], { json: true, temperature: 0.2, max_tokens: 1500 });
  const cats = (parseJson<{ categories: Cat[] }>(r.content)?.categories ?? []).filter((c) => c?.name).slice(0, MAX_CATEGORIES)
    .map((c) => ({ name: String(c.name).slice(0, 40), desc: String(c.desc ?? '').slice(0, 200) }));
  if (cats.length) await saveTaxonomy(db, cats);
  await db.from('ai_usage').insert({ model: 'deepseek-chat', prompt_tokens: r.usage.prompt_tokens, cache_hit_tokens: r.usage.prompt_cache_hit_tokens ?? 0, completion_tokens: r.usage.completion_tokens });
  return cats;
}

const num = (v: unknown) => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) && String(v ?? '') !== '' ? n : null; };
const date = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);

async function analyzeOne(db: ReturnType<typeof admin>, id: string, cats: Cat[]) {
  const { data: d } = await db.from('documents').select('id, title, path, ext').eq('id', id).single();
  const { data: chunks } = await db.from('doc_chunks').select('idx, content').eq('doc_id', id).order('idx');
  const all = (chunks ?? []).map((c) => c.content).join('\n');
  // начало (шапка, стороны, номер) + конец (итоги, суммы, подписи)
  const text = all.length > 4200 ? `${all.slice(0, 2800)}\n[…]\n${all.slice(-1400)}` : all;
  const prompt = `Dokument firmy CK Complex. Wyciągnij dane. Odpowiedz json:
{"category":"jedna z listy poniżej (dokładna nazwa)","doc_type":"faktura|faktura zaliczkowa|zamówienie|umowa|aneks|oferta|porozumienie|raport|prezentacja|protokół|korespondencja|budżet|zestawienie|ankieta|oświadczenie|specyfikacja|inne","summary":"2 zdania: czego dotyczy i najważniejsze liczby/ustalenia","doc_date":"YYYY-MM-DD albo null (data wystawienia/dokumentu)","counterparty":"druga strona / wystawca / kontrahent albo null","number":"numer dokumentu albo null","net":liczba|null,"vat":liczba|null,"gross":liczba|null,"currency":"PLN|EUR|USD|null","topics":["3–6 słów kluczowych"]}
Zasady: kwoty tylko gdy wprost w dokumencie (łączne wartości dokumentu, nie pozycje); liczby bez spacji, kropka dziesiętna; nic nie zgaduj — brak danych = null.
Kategorie:
${cats.map((c) => `- ${c.name}: ${c.desc}`).join('\n')}

Plik: ${d!.title}
Folder: ${d!.path}
Treść:
${text}`;
  const r = await deepseek([{ role: 'user', content: prompt }], { json: true, temperature: 0, max_tokens: 700 });
  const o = parseJson<any>(r.content) ?? {};
  const category = cats.find((c) => c.name.toLowerCase() === String(o.category ?? '').toLowerCase())?.name ?? cats[0]?.name ?? 'Dokumenty';
  await db.from('documents').update({
    category, doc_type: o.doc_type ? String(o.doc_type).slice(0, 40) : null, summary: o.summary ? String(o.summary).slice(0, 600) : null,
    doc_date: date(o.doc_date), counterparty: o.counterparty ? String(o.counterparty).slice(0, 120) : null, number: o.number ? String(o.number).slice(0, 80) : null,
    net: num(o.net), vat: num(o.vat), gross: num(o.gross), currency: o.currency && o.currency !== 'null' ? String(o.currency).slice(0, 6) : null,
    meta: { topics: Array.isArray(o.topics) ? o.topics.slice(0, 8).map(String) : [] }, status: 'ready',
  }).eq('id', id);
  return r.usage;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!(await requireUser(req))) return json({ error: 'unauthorized' }, 401);
  const db = admin();
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === 'taxonomy') return json({ categories: await buildTaxonomy(db) });
    if (body.action === 'analyze') {
      let cats = await getTaxonomy(db);
      if (!cats.length || body.rebuild) cats = await buildTaxonomy(db);
      if (!cats.length) cats = [{ name: 'Dokumenty', desc: 'Wszystkie dokumenty' }];
      const q = db.from('documents').select('id').eq('status', 'new').order('created_at').limit(Math.min(Number(body.limit) || 8, 12));
      const { data: todo } = await q;
      const usage = { p: 0, h: 0, c: 0 }; let failed = 0;
      await Promise.all((todo ?? []).map(async (d) => {
        try { const u = await analyzeOne(db, d.id, cats); usage.p += u.prompt_tokens ?? 0; usage.h += u.prompt_cache_hit_tokens ?? 0; usage.c += u.completion_tokens ?? 0; }
        catch { failed++; await db.from('documents').update({ status: 'error' }).eq('id', d.id); }
      }));
      if (todo?.length) await db.from('ai_usage').insert({ model: 'deepseek-chat', prompt_tokens: usage.p, cache_hit_tokens: usage.h, completion_tokens: usage.c });
      const { count } = await db.from('documents').select('id', { count: 'exact', head: true }).eq('status', 'new');
      return json({ done: (todo?.length ?? 0) - failed, failed, remaining: count ?? 0 });
    }
    if (body.action === 'reset') { // перераспределить всё заново (после смены набора документов)
      await db.from('documents').update({ status: 'new' }).neq('status', 'new');
      return json({ categories: await buildTaxonomy(db) });
    }
    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
