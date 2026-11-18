// Геокодирование точек продаж по их кодам (например «GLI-DWORCOWA47», «ADC-WRO-DOMINIKANSKA»).
// 1) DeepSeek раскладывает код на город / улицу / объект (одним пакетным запросом, мало токенов);
// 2) координаты ищет браузер (Nominatim), см. src/lib/data/geocode.ts.
// Функция разбирает порцию кодов и возвращает остаток неразобранных.
import { admin, cors, deepseek, json, parseJson, requireUser, requireWorkspace } from '../_shared/util.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const ws = await requireWorkspace(req, user);
  if (!ws) return json({ error: 'Brak dostępu do tego workspace' }, 403);
  const db = admin(ws);
  const body = await req.json().catch(() => ({}));

  if (body.action === 'reset') {
    await db.from('locations').update({ status: 'pending', lat: null, lng: null, city: null, street: null }).eq('workspace_id', ws).neq('status', 'manual');
    return json({ ok: true });
  }

  // шаг 1: разбор кодов ИИ (для всех ещё не разобранных, одним запросом до 120 кодов)
  const { data: unparsed } = await db.from('locations').select('code').eq('workspace_id', ws).eq('status', 'pending').is('city', null).limit(45);
  if (unparsed?.length) {
    const codes = unparsed.map((r) => r.code);
    const prompt = `Polish retail shop codes of a vape-shop chain. Each code = CITY abbreviation + street name (often without Polish diacritics, sometimes with prefixes like "AL" aleja, "PL" plac, "OS" osiedle, "GEN", "BOH", "WOJ" Wojska, "JP2"/"JANAPAWLAII") + house number. Codes starting "ADC-" are kiosks in shopping malls: ADC-<CITY>-<mall or street>.
Decode each code. Restore Polish diacritics and full street names (e.g. "KUSOCINSKIEGO4" → "Kusocińskiego 4", "WPOLSKIEGO8" → "Wojska Polskiego 8", "JNARODOWEJ24" → "Jedności Narodowej 24", "AKRAJOWEJ33" → "Armii Krajowej 33", "NMP9" → "Najświętszej Maryi Panny 9", "BOHWESTERPLATT16" → "Bohaterów Westerplatte 16", "CHFOCUS" → "Focus Mall", "PASAZURSYNOWSKI7" → "Pasaż Ursynowski 7"). City abbreviations follow Polish car-plate / common 3-letter codes (WWA/WAR Warszawa, KRA Kraków, POZ Poznań, WRO Wrocław, GDA Gdańsk, GDY Gdynia, SOP Sopot, SZC Szczecin, LOD Łódź, LUB Lublin, BIA Białystok, BYD Bydgoszcz, TOR Toruń, OLS Olsztyn, ZGO Zielona Góra, GLO Głogów, KAT Katowice, GLI Gliwice, RZE Rzeszów, OPO Opole, KAL Kalisz, KON Konin, PIL Piła, SLU Słupsk, KOS Koszalin…). Pick the real Polish town that has such a street; prefer larger towns when unsure.
Reply json: {"items":[{"code":"…","city":"Gliwice","street":"Dworcowa 47","place":null,"label":"Gliwice, ul. Dworcowa 47"}]} — "place" = mall/building name if known, else null. Codes:\n${codes.join('\n')}`;
    try {
      const r = await deepseek([{ role: 'user', content: prompt }], { json: true, temperature: 0, max_tokens: 6000 });
      const items = parseJson<{ items: any[] }>(r.content)?.items ?? [];
      await db.from('ai_usage').insert({ model: 'deepseek-chat', prompt_tokens: r.usage.prompt_tokens, cache_hit_tokens: r.usage.prompt_cache_hit_tokens ?? 0, completion_tokens: r.usage.completion_tokens });
      for (const it of items) {
        if (!it?.code || !codes.includes(it.code)) continue;
        await db.from('locations').update({
          city: it.city ?? null, street: it.street ?? null, label: it.label ?? null, note: it.place ?? null, updated_at: new Date().toISOString(),
        }).eq('workspace_id', ws).eq('code', it.code);
      }
    } catch (e) {
      return json({ error: `AI: ${e instanceof Error ? e.message : e}` }, 500);
    }
    const { count } = await db.from('locations').select('code', { count: 'exact', head: true }).eq('workspace_id', ws).eq('status', 'pending').is('city', null);
    return json({ parsed: unparsed.length, remaining: count ?? 0 });
  }

  // координаты ищет браузер (src/lib/data/geocode.ts): из облачных IP OSM отвечает медленно и отказывает
  const { count } = await db.from('locations').select('code', { count: 'exact', head: true }).eq('workspace_id', ws).eq('status', 'pending').is('city', null);
  return json({ parsed: 0, remaining: count ?? 0 });
});
