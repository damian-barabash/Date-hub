import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

// Текущий воркспейс уходит заголовком x-workspace в КАЖДЫЙ запрос (REST, RPC, edge) — сервер (public.cur_ws) сам фильтрует данные.
const WS_KEY = 'dh-ws';
let WS: string | null = (() => { try { return localStorage.getItem(WS_KEY); } catch { return null; } })();
export const getWorkspace = () => { try { return localStorage.getItem(WS_KEY) ?? WS; } catch { return WS; } };
export function setWorkspace(id: string | null) {
  WS = id;
  try { if (id) localStorage.setItem(WS_KEY, id); else localStorage.removeItem(WS_KEY); } catch { /* приватный режим */ }
}
export const wsHeaders = (): Record<string, string> => (WS ? { 'x-workspace': WS } : {});

export const supabase = createClient(SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY as string, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'datehub-auth' },
  global: {
    fetch: (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (WS && !headers.has('x-workspace')) headers.set('x-workspace', WS);
      return fetch(input, { ...init, headers });
    },
  },
});

export const LOGIN_DOMAIN = 'datehub.infinitiq.pl';
export const loginToEmail = (login: string) => (login.includes('@') ? login : `${login.trim().toLowerCase()}@${LOGIN_DOMAIN}`);

/** Вызов edge function с JSON-ответом. */
export async function fn<T = any>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}
