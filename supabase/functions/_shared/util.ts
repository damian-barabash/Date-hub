import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'content-type': 'application/json' } });

export const admin = (): SupabaseClient =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

/** Проверка сессии вошедшего пользователя (JWT из заголовка). */
export async function requireUser(req: Request): Promise<User | null> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface DeepSeekUsage { prompt_tokens: number; completion_tokens: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number }

export async function deepseek(
  messages: { role: string; content: string }[],
  opts: { model?: string; temperature?: number; json?: boolean; max_tokens?: number } = {},
): Promise<{ content: string; usage: DeepSeekUsage }> {
  const key = Deno.env.get('DEEPSEEK_API_KEY');
  if (!key) throw new Error('DEEPSEEK_API_KEY is not set');
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: opts.model ?? 'deepseek-chat',
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.max_tokens ?? 2500,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return { content: data.choices?.[0]?.message?.content ?? '', usage: data.usage ?? {} };
}

/** JSON из ответа модели (снимает ```json-обёртки, если модель их добавила). */
export function parseJson<T = Record<string, unknown>>(s: string): T | null {
  const t = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const m = t.match(/\{[\s\S]*\}/);
  for (const cand of [t, m?.[0], escapeControlInStrings(m?.[0] ?? t)]) {
    if (!cand) continue;
    try { return JSON.parse(cand) as T; } catch { /* next */ }
  }
  return null;
}

/** Модель иногда ставит «живые» переводы строк внутри строковых значений — экранируем их. */
function escapeControlInStrings(s: string): string {
  let out = ''; let inStr = false; let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) { esc = false; out += ch; continue; }
      if (ch === '\\') { esc = true; out += ch; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') continue;
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return out;
}
