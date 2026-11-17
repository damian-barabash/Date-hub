// AI DATA HUB — чат-аналитик на DeepSeek.
// Экономия токенов:
//  1) статичный system-промпт + стабильная «карточка» набора данных идут первыми → кэш префикса DeepSeek (≈10× дешевле);
//  2) модель видит схему и агрегаты, а не сырые строки: пишет SQL, считает Postgres;
//  3) результаты к модели уходят компактным CSV (≤ rows_to_model строк, округление), полные — только клиенту;
//  4) диаграммы ссылаются на результат запроса по id — модель не печатает массивы данных;
//  5) история — только тексты последних N ответов, обрезанные;
//  6) кэш одинаковых вопросов (по версии набора данных).
import { admin, cors, deepseek, json, parseJson, requireUser, sha256, type DeepSeekUsage } from '../_shared/util.ts';

interface Settings { model: string; temperature: number; history_turns: number; rows_to_model: number; rows_to_client: number; cache: boolean; cache_ttl_hours: number; max_rounds: number }
interface Query { id: string; sql: string; purpose?: string }
interface Result { columns: string[]; rows: Record<string, unknown>[]; error?: string; sql: string; purpose?: string }

const SYSTEM = `You are "AI DATA HUB", a senior retail-analytics assistant for company directors (CK Complex, a Polish chain of e-cigarette / vape shops).
You answer questions about sales, managers (kierownicy), shops/warehouses (magazyny), products, margins and finances using a PostgreSQL database.
Always reply with ONE json object, no prose outside json.

## Protocol
Step 1 — if you need data, reply: {"queries":[{"id":"q1","sql":"SELECT ...","purpose":"short purpose"}]}
  - up to 4 queries per step; ids q1,q2,... unique within the conversation turn.
  - The server runs them and returns compact CSV results. You may then request more queries or answer.
Step 2 — final answer: {"title":"max 5 words","text":"markdown","blocks":[...],"suggestions":["…","…","…"]}
If no data is needed (greeting, general question) answer immediately with the final format.

## SQL rules (PostgreSQL)
- Read-only SELECT/WITH only, one statement, no semicolons. Use only tables described in DATA CONTEXT.
- ALWAYS aggregate in SQL (sum/avg/count/group by). Never fetch raw rows unless the user explicitly asks for a list; then LIMIT ≤ 100.
- Charts: ≤ 30 categories (use ORDER BY … LIMIT, group the rest into "Inne" only when helpful). Heatmaps/3D: ≤ 25×25.
- Round money to 2 decimals: round(sum(x)::numeric, 2). Percentages as fractions 0..1 rounded to 4 decimals (format "pct" renders them).
- Weighted margin = sum(profit)/nullif(sum(net),0). Gross (brutto) includes VAT — profit is NOT gross minus net.
- Use readable column aliases in snake_case (they become axis names). Text matching: ILIKE with % for names.
- To place shops on a map join public.locations l ON l.code = <location column> (l.city, l.region, l.lat, l.lng).

## Blocks (visuals render with smooth animation on the client)
chart: {"type":"chart","q":"q1","chart":KIND,"title":"…","subtitle":"…", mapping fields…, "format":"pln|pct|int|num","group":GROUP}
  KIND & mapping:
  bar|line|area: "x":"col","y":["col",…] (multiple y = grouped series), optional "series":"col" (pivot long data), "stack":true, "horizontal":true
  waterfall: "x","y":["col"]
  pie|donut|rose|funnel: "name":"col","value":"col"
  treemap|sunburst: "path":["col_lvl1","col_lvl2"],"value":"col"
  scatter|bubble: "x":"col","y":["col"],"size":"col?","name":"col?"
  heatmap: "x":"col","y":["col"],"value":"col"
  radar: "name":"col" (one series per row),"y":["metric1","metric2",…] (3–8 metrics)
  gauge: "value":"col" (first row), optional "max": number
  sankey|graph: "source":"col","target":"col","value":"col"
  bar3d|scatter3d|surface3d: "x":"col","y":["col"],"z":"col"   (3D, rotates)
  network3d: "source":"col","target":"col","value":"col"        (3D force network, e.g. manager → shops)
  map: "name":"location code col","value":"col"                  (shops on the map of Poland)
kpis: {"type":"kpis","items":[{"label":"…","value":123.45,"format":"pln|pct|int|num","group":GROUP,"hint":"short"}]}  (2–6 items, values copied from results)
table: {"type":"table","q":"q1","title":"…","columns":["col",…]}
callout: {"type":"callout","tone":"warn|info|good","md":"…"}
text: {"type":"text","md":"…"}  (for long reports: sections between visuals)
GROUP (accent colour family): managers | locations | products | finance | alerts | ai
Prefer 1–2 visuals for a simple question; for "raport"/report requests build a full report: kpis + 3–6 charts + text sections + callouts.
Pick the visual that best shows the insight (ranking → horizontal bar, share → donut/treemap, distribution → bar of buckets, relation → scatter/bubble, structure → sankey/network3d, geography → map). Use 3D only when asked or when it truly adds value.

## Text
"text": 60–160 words of markdown in the user's language (Polish by default, English if the user writes English / lang=en). Structure:
**Podsumowanie:** key insight with concrete numbers. **Uwaga:** risk/anomaly (if any). **Sugestia:** next action.
(English: **Summary:** / **Watch out:** / **Suggestion:**). Format money like "1,32 mln zł" / "48 230 zł". Never invent numbers that are not in results.
"suggestions": exactly 3 short follow-up questions in the user's language.`;

function fmtNum(v: unknown): string {
  if (typeof v !== 'number') return v === null || v === undefined ? '' : String(v).replace(/[\n,]/g, ' ').slice(0, 60);
  if (Number.isInteger(v)) return String(v);
  return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4);
}

function toCsv(r: Result, max: number): string {
  if (r.error) return `ERROR: ${r.error}`;
  if (!r.rows.length) return '(0 rows)';
  const head = r.columns.join(',');
  const body = r.rows.slice(0, max).map((row) => r.columns.map((c) => fmtNum(row[c])).join(',')).join('\n');
  const more = r.rows.length > max ? `\n… ${r.rows.length - max} more rows (client sees all ${r.rows.length})` : '';
  return `${head}\n${body}${more}`;
}

// «Карточка» набора данных — стабильна между запросами (кэшируется DeepSeek как префикс)
function datasetCard(d: Record<string, any>, locCount: number): string {
  const lines: string[] = [];
  lines.push(`DATA CONTEXT`);
  lines.push(`Main table: ds.${d.table_name}  (dataset "${d.name}", ${d.row_count} rows${d.meta?.period ? `, period ${d.meta.period}` : ''})`);
  if (d.meta?.notes?.length) lines.push(`Export notes: ${String(d.meta.notes.join(' | ')).replace(/\s+/g, ' ').slice(0, 300)}`);
  lines.push('Columns:');
  for (const c of d.columns as any[]) {
    const s = c.stats ?? {};
    let info = '';
    if (c.type === 'number' || c.type === 'integer') {
      info = `min=${fmtNum(s.min)} max=${fmtNum(s.max)} sum=${fmtNum(s.sum)}`;
    } else {
      const top = (s.top ?? []).slice(0, 6).map((t: [string, number]) => String(t[0]).slice(0, 40)).join('; ');
      info = `${s.distinct ?? '?'} distinct${top ? `; e.g. ${top}` : ''}`;
    }
    const der = c.derived ? ` = ${c.derived.op}(${[c.derived.a, c.derived.b].filter(Boolean).join(',')})` : '';
    lines.push(`- ${c.key} ${c.type}${c.role ? ` [${c.role}]` : ''}${der} — "${c.label}"; ${info}`);
  }
  const r = d.roles ?? {};
  const hints: string[] = [];
  if (r.net) hints.push(`revenue (net) = sum(${r.net})`);
  if (r.gross) hints.push(`gross incl. VAT = sum(${r.gross})`);
  if (r.profit) hints.push(`profit = sum(${r.profit})`);
  if (r.profit && r.net) hints.push(`margin % = sum(${r.profit})/nullif(sum(${r.net}),0)`);
  if (r.qty) hints.push(`units = sum(${r.qty})`);
  if (r.margin) hints.push(`${r.margin} is per-row margin ratio (0..1, negatives = loss)`);
  if (hints.length) lines.push(`Metric hints: ${hints.join('; ')}`);
  lines.push(`Lookup table: public.locations(code, name, city, street, postal, region [voivodeship], branch [sales branch e.g. RG_01], kind [Stacjonarny = street shop | Wyspa = mall island], email, lat, lng) — ${locCount} shops geocoded${r.location ? `, join on ds.${d.table_name}.${r.location} = locations.code` : ''}`);
  return lines.join('\n');
}

function briefAssistant(c: any): string {
  const charts = (c?.blocks ?? []).filter((b: any) => b.title).map((b: any) => b.title).slice(0, 4).join('; ');
  return `${String(c?.text ?? '').slice(0, 500)}${charts ? `\n[visuals: ${charts}]` : ''}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const message: string = String(body.message ?? '').trim().slice(0, 4000);
  if (!message) return json({ error: 'empty message' }, 400);
  const lang: string = body.lang === 'en' ? 'en' : 'pl';
  const db = admin();

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const enc = new TextEncoder();
  const send = (event: string, data: unknown) => writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

  (async () => {
    const usage = { prompt: 0, hit: 0, completion: 0 };
    try {
      await send('status', { step: 'context' });
      const [{ data: st }, dsRes, { count: locCount }] = await Promise.all([
        db.from('app_settings').select('value').eq('key', 'ai').maybeSingle(),
        body.dataset_id
          ? db.from('datasets').select('*').eq('id', body.dataset_id).maybeSingle()
          : db.from('datasets').select('*').eq('is_active', true).maybeSingle(),
        db.from('locations').select('code', { count: 'exact', head: true }).not('lat', 'is', null),
      ]);
      const s: Settings = { model: 'deepseek-chat', temperature: 0.3, history_turns: 6, rows_to_model: 40, rows_to_client: 500, cache: true, cache_ttl_hours: 24, max_rounds: 3, ...(st?.value ?? {}) };
      const dataset = dsRes.data;

      // чат
      let chatId: string = body.chat_id;
      if (!chatId) {
        const { data: chat, error } = await db.from('chats')
          .insert({ title: message.slice(0, 60), created_by: user.id, dataset_id: dataset?.id ?? null }).select('id').single();
        if (error) throw error;
        chatId = chat.id;
      } else {
        const { data: own } = await db.from('chats').select('id').eq('id', chatId).eq('created_by', user.id).maybeSingle();
        if (!own) throw new Error('chat not found');
      }
      await send('chat', { chat_id: chatId });

      const { data: hist } = await db.from('messages').select('role, content').eq('chat_id', chatId)
        .order('created_at', { ascending: false }).limit(s.history_turns * 2);
      await db.from('messages').insert({ chat_id: chatId, role: 'user', content: { text: message } });
      const history = (hist ?? []).reverse().map((m: any) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.role === 'user' ? String(m.content?.text ?? '').slice(0, 800) : briefAssistant(m.content),
      }));

      // кэш одинаковых вопросов (только без контекста беседы)
      const cacheKey = await sha256([dataset?.id, dataset?.version, lang, message.toLowerCase().replace(/\s+/g, ' ')].join('|'));
      if (s.cache && !history.length) {
        const { data: hit } = await db.from('ai_cache').select('answer, created_at, hits').eq('hash', cacheKey).maybeSingle();
        if (hit && Date.now() - new Date(hit.created_at).getTime() < s.cache_ttl_hours * 3600e3) {
          await db.from('ai_cache').update({ hits: (hit.hits ?? 0) + 1 }).eq('hash', cacheKey);
          const content = { ...hit.answer, cached: true };
          const { data: saved } = await db.from('messages').insert({ chat_id: chatId, role: 'assistant', content, usage: { cached: true } }).select('id, created_at').single();
          await db.from('chats').update({ updated_at: new Date().toISOString(), ...(hit.answer.title ? { title: hit.answer.title } : {}) }).eq('id', chatId);
          await db.from('ai_usage').insert({ user_id: user.id, model: s.model, cached_answer: true });
          await send('final', { ...content, id: saved?.id, chat_id: chatId });
          return;
        }
      }

      const msgs: { role: string; content: string }[] = [
        { role: 'system', content: SYSTEM },
        { role: 'system', content: dataset ? datasetCard(dataset, locCount ?? 0) : 'DATA CONTEXT: no dataset loaded yet. Tell the user to upload data in "Źródła danych".' },
        ...history,
        { role: 'user', content: `${message}\n\n(lang=${lang})` },
      ];

      const results: Record<string, Result> = {};
      let final: any = null;
      for (let round = 0; round <= s.max_rounds; round++) {
        await send('status', { step: round === 0 ? 'thinking' : 'analysing', round });
        const r = await deepseek(msgs, { model: s.model, temperature: s.temperature, json: true, max_tokens: 3000 });
        usage.prompt += r.usage.prompt_tokens ?? 0;
        usage.hit += r.usage.prompt_cache_hit_tokens ?? 0;
        usage.completion += r.usage.completion_tokens ?? 0;
        const obj = parseJson<any>(r.content);
        if (!obj) { final = { text: r.content.slice(0, 3000), blocks: [], suggestions: [] }; break; }
        const queries: Query[] = Array.isArray(obj.queries) ? obj.queries.slice(0, 4) : [];
        if (!queries.length || round === s.max_rounds || !dataset) { final = obj; break; }

        msgs.push({ role: 'assistant', content: JSON.stringify({ queries }) });
        const parts: string[] = [];
        for (const q of queries) {
          const id = String(q.id || `q${Object.keys(results).length + 1}`).replace(/[^\w]/g, '').slice(0, 10);
          await send('query', { id, purpose: q.purpose ?? '', sql: q.sql });
          const { data, error } = await db.rpc('ai_sql', { p_sql: String(q.sql ?? ''), p_limit: s.rows_to_client });
          const rows = (error ? [] : (data as Record<string, unknown>[])) ?? [];
          const res: Result = { columns: rows.length ? Object.keys(rows[0]) : [], rows, sql: q.sql, purpose: q.purpose, ...(error ? { error: error.message } : {}) };
          results[id] = res;
          await send('result', { id, rows: rows.length, error: res.error });
          parts.push(`### ${id}${q.purpose ? ` (${q.purpose})` : ''} — ${rows.length} rows\n${toCsv(res, s.rows_to_model)}`);
        }
        const lastRound = round + 1 >= s.max_rounds;
        msgs.push({
          role: 'user',
          content: `RESULTS\n${parts.join('\n\n')}\n\n${lastRound ? 'Now give the FINAL answer json (no more queries).' : 'Fix failed queries if needed, or give the FINAL answer json.'}`,
        });
      }

      await send('status', { step: 'visualising' });
      const blocks = (Array.isArray(final?.blocks) ? final.blocks : []).filter((b: any) => b && typeof b === 'object').slice(0, 12);
      const used = new Set(blocks.map((b: any) => b.q).filter(Boolean));
      const out: Record<string, { columns: string[]; rows: Record<string, unknown>[] }> = {};
      for (const id of used) if (results[id as string] && !results[id as string].error) out[id as string] = { columns: results[id as string].columns, rows: results[id as string].rows };
      const content = {
        title: typeof final?.title === 'string' ? final.title.slice(0, 60) : undefined,
        text: String(final?.text ?? ''),
        blocks: blocks.filter((b: any) => !b.q || out[b.q]),
        suggestions: (Array.isArray(final?.suggestions) ? final.suggestions : []).slice(0, 3).map(String),
        results: out,
        queries: Object.entries(results).map(([id, r]) => ({ id, sql: r.sql, purpose: r.purpose, rows: r.rows.length, error: r.error })),
        dataset_id: dataset?.id ?? null,
      };
      const u = { prompt_tokens: usage.prompt, cache_hit_tokens: usage.hit, completion_tokens: usage.completion };
      const { data: saved } = await db.from('messages').insert({ chat_id: chatId, role: 'assistant', content, usage: u }).select('id').single();
      const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (!history.length && content.title) upd.title = content.title;
      await db.from('chats').update(upd).eq('id', chatId);
      await db.from('ai_usage').insert({ user_id: user.id, model: s.model, ...u });
      if (s.cache && !history.length && content.text && !content.queries.some((q) => q.error)) {
        await db.from('ai_cache').upsert({ hash: cacheKey, answer: content, hits: 0, created_at: new Date().toISOString() });
      }
      await send('final', { ...content, id: saved?.id, chat_id: chatId, usage: u });
    } catch (e) {
      await send('error', { message: e instanceof Error ? e.message : String(e) });
    } finally {
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
  });
});

export type { DeepSeekUsage };
