import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const supabase = createClient(SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY as string, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'datehub-auth' },
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
