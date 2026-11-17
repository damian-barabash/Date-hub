import { supabase, SUPABASE_URL } from '../supabase';

export type AiEvent =
  | { event: 'status'; data: { step: string; round?: number } }
  | { event: 'chat'; data: { chat_id: string } }
  | { event: 'query'; data: { id: string; purpose: string; sql: string } }
  | { event: 'result'; data: { id: string; rows: number; error?: string } }
  | { event: 'final'; data: any }
  | { event: 'error'; data: { message: string } };

/** POST в edge function «ai» с чтением SSE-потока шагов. */
export async function askAI(body: { message: string; chat_id?: string; dataset_id?: string; lang: string }, on: (e: AiEvent) => void, signal?: AbortSignal) {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_KEY },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const m = chunk.match(/^event: (\w+)\ndata: ([\s\S]*)$/);
      if (m) { try { on({ event: m[1], data: JSON.parse(m[2]) } as AiEvent); } catch { /* ignore broken chunk */ } }
    }
  }
}
