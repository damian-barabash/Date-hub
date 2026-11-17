// Доступ ИИ к интернету: поиск и чтение страниц / открытых API.
// Защита: только http(s) на публичные хосты (никаких внутренних адресов), таймаут, лимит размера,
// ответы обрезаются — модель получает сжатый текст, а не страницу целиком (экономия токенов).

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const TIMEOUT = 9000;
const MAX_BYTES = 600_000;

function isPublic(u: URL): boolean {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return false;
  if (h.includes(':') || h.startsWith('[')) return false; // IPv6-литералы
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return false;
  }
  if (/supabase\.(co|in|net)$/.test(h) || h.endsWith('.supabase.co')) return false; // свой бэкенд — только через SQL
  return true;
}

async function get(url: string, accept: string): Promise<Response> {
  let cur = url;
  for (let i = 0; i < 4; i++) {
    const u = new URL(cur);
    if (!isPublic(u)) throw new Error('address not allowed');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(u, { headers: { 'user-agent': UA, accept, 'accept-language': 'pl,en;q=0.8' }, redirect: 'manual', signal: ctrl.signal });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { cur = new URL(res.headers.get('location')!, u).href; await res.body?.cancel(); continue; }
      return res;
    } finally { clearTimeout(timer); }
  }
  throw new Error('too many redirects');
}

async function readText(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); break; }
  }
  const buf = new Uint8Array(size); let o = 0;
  for (const c of chunks) { buf.set(c.subarray(0, Math.min(c.length, size - o)), o); o += c.length; if (o >= size) break; }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_m, d) => String.fromCodePoint(parseInt(d, 16)));

export function htmlToText(html: string): string {
  const main = html.match(/<(main|article)[\s\S]*?<\/\1>/i)?.[0] ?? html;
  return decode(main
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|br)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

/** Числа в JSON округляем — открытые API отдают длинные хвосты, это лишние токены. */
function compactJson(v: unknown): unknown {
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * 1000) / 1000;
  if (Array.isArray(v)) return v.map(compactJson);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, compactJson(x)]));
  return v;
}

export interface WebResult { kind: 'search' | 'page'; title: string; url: string; text: string; error?: string }

/** Чтение страницы: напрямую, а если сайт не пускает серверы или отдал пустышку — через читалку Jina. */
export async function webFetch(url: string, limit = 5000): Promise<WebResult> {
  const direct = await fetchDirect(url, limit);
  if (!direct.error && direct.text.length > 300) return direct;
  if (/^https?:\/\/r\.jina\.ai\//.test(url)) return direct;
  try {
    if (!isPublic(new URL(url))) return direct;
    const res = await get(`https://r.jina.ai/${url}`, 'text/plain');
    if (res.ok) {
      const md = (await readText(res)).replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\]\((?:https?:)?\/\/[^)]{60,}\)/g, ']').replace(/\n{3,}/g, '\n\n');
      const title = md.match(/^Title:\s*(.+)$/m)?.[1]?.slice(0, 120) ?? new URL(url).hostname;
      const body = md.replace(/^[\s\S]*?Markdown Content:\s*/, '');
      if (body.trim().length > 200) return { kind: 'page', title, url, text: body.slice(0, limit) };
    } else await res.body?.cancel();
  } catch { /* вернём прямой результат */ }
  return direct;
}

async function fetchDirect(url: string, limit: number): Promise<WebResult> {
  try {
    const res = await get(url, 'application/json,text/html;q=0.9,text/plain;q=0.8,*/*;q=0.5');
    if (!res.ok) { await res.body?.cancel(); return { kind: 'page', title: '', url, text: '', error: `HTTP ${res.status}` }; }
    const ct = res.headers.get('content-type') ?? '';
    const raw = await readText(res);
    if (/json/.test(ct) || /^[\[{]/.test(raw.trim())) {
      try { return { kind: 'page', title: new URL(url).hostname, url, text: JSON.stringify(compactJson(JSON.parse(raw))).slice(0, limit * 2) }; } catch { /* not json */ }
    }
    if (!/html|text|xml|csv/.test(ct) && ct) return { kind: 'page', title: '', url, text: '', error: `unsupported content type ${ct}` };
    const title = decode(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim().slice(0, 120);
    return { kind: 'page', title: title || new URL(url).hostname, url, text: (/html/.test(ct) || /<html/i.test(raw) ? htmlToText(raw) : raw).slice(0, limit) };
  } catch (e) {
    return { kind: 'page', title: '', url, text: '', error: e instanceof Error ? e.message : String(e) };
  }
}

const stripMd = (x: string) => x.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

/** DuckDuckGo через читалку Jina: с серверных адресов прямой DDG отдаёт пустую страницу. */
async function searchDdg(q: string): Promise<string[]> {
  const res = await get(`https://r.jina.ai/https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=pl-pl`, 'text/plain');
  if (!res.ok) { await res.body?.cancel(); return []; }
  const md = await readText(res);
  const out: string[] = [];
  for (const block of md.split(/\n## \[/).slice(1)) {
    const head = block.match(/^([^\]]+)\]\(([^)]+)\)/);
    if (!head) continue;
    let href = head[2];
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) { try { href = decodeURIComponent(uddg[1]); } catch { continue; } }
    if (!/^https?:\/\//.test(href) || /duckduckgo\.com\/y\.js/.test(href)) continue;
    // сниппет — последняя ссылка-абзац блока
    const links = [...block.matchAll(/\[((?:[^\[\]]|\[[^\]]*\])+)\]\(https:\/\/duckduckgo\.com\/l\/[^)]*\)/g)].map((m) => stripMd(m[1])).filter((t) => t.length > 60);
    out.push(`${out.length + 1}. ${stripMd(head[1])}\n   ${href}\n   ${(links.at(-1) ?? '').slice(0, 300)}`);
    if (out.length >= 7) break;
  }
  return out;
}

async function searchYahoo(q: string): Promise<string[]> {
  const res = await get(`https://search.yahoo.com/search?p=${encodeURIComponent(q)}&vl=lang_pl`, 'text/html');
  if (!res.ok) { await res.body?.cancel(); return []; }
  const html = await readText(res);
  const strip = (x: string) => decode(x.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  for (const chunk of html.split('<div class="compTitle').slice(1)) {
    const ru = chunk.match(/\/RU=([^/]+)\/RK=/);
    if (!ru) continue;
    let href = ''; try { href = decodeURIComponent(ru[1]); } catch { continue; }
    if (!/^https?:\/\//.test(href) || /yahoo\.com/.test(href)) continue;
    const title = strip(chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? '').replace(/^.*?›\s*[^ ]*\s*/, '');
    const snip = strip(chunk.match(/class="compText[^"]*"[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '');
    out.push(`${out.length + 1}. ${title || new URL(href).hostname}\n   ${href}\n   ${snip.slice(0, 300)}`);
    if (out.length >= 7) break;
  }
  return out;
}

/** Поиск без ключей: DuckDuckGo → Yahoo → Википедия (pl, en). */
export async function webSearch(q: string): Promise<WebResult> {
  const url = `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
  let items: string[] = [];
  for (const engine of [searchDdg, searchYahoo]) {
    try { items = await engine(q); } catch { items = []; }
    if (items.length) break;
  }
  if (!items.length) {
    for (const lang of ['pl', 'en']) {
      try {
        const res = await get(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=${encodeURIComponent(q)}`, 'application/json');
        const j = await res.json();
        for (const it of j?.query?.search ?? []) {
          items.push(`${items.length + 1}. ${it.title}\n   https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(it.title).replace(/ /g, '_'))}\n   ${decode(String(it.snippet ?? '').replace(/<[^>]+>/g, '')).slice(0, 260)}`);
        }
      } catch { /* ignore */ }
      if (items.length) break;
    }
  }
  return { kind: 'search', title: q, url, text: items.join('\n'), ...(items.length ? {} : { error: 'no results' }) };
}
