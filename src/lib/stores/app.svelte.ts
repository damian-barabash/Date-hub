import type { Session } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import type { Column, Role } from '../data/infer';
import { loadDocStats } from '../docs/store.svelte';

export interface Dataset {
  id: string;
  name: string;
  source: string;
  table_name: string;
  columns: Column[];
  roles: Partial<Record<Role, string>>;
  meta: { period?: string; notes?: string[]; file?: string; [k: string]: unknown };
  row_count: number;
  status: string;
  is_active: boolean;
  version: number;
  connector_id: string | null;
  created_at: string;
  updated_at: string;
}
export interface Chat { id: string; title: string; updated_at: string; created_at: string }
export interface Location { code: string; label: string | null; city: string | null; street: string | null; region: string | null; lat: number | null; lng: number | null; status: string; note: string | null; postal: string | null; name: string | null; branch: string | null; kind: string | null; email: string | null; store_id: string | null; source: string }

export const app = $state({
  session: null as Session | null,
  ready: false,
  datasets: [] as Dataset[],
  chats: [] as Chat[],
  locations: [] as Location[],
  sidebarOpen: false,
  sidebarCollapsed: false,
  toast: null as { text: string; tone: 'ok' | 'err' | 'info'; id: number } | null,
});

export const active = (): Dataset | null => app.datasets.find((d) => d.is_active && d.status === 'ready') ?? app.datasets.find((d) => d.status === 'ready') ?? null;

export function toast(text: string, tone: 'ok' | 'err' | 'info' = 'ok') {
  const id = Date.now();
  app.toast = { text, tone, id };
  setTimeout(() => { if (app.toast?.id === id) app.toast = null; }, 4200);
}

export async function loadDatasets() {
  const { data } = await supabase.from('datasets').select('*').order('created_at', { ascending: false });
  app.datasets = (data ?? []) as Dataset[];
}
export async function loadChats() {
  const { data } = await supabase.from('chats').select('id, title, updated_at, created_at').order('updated_at', { ascending: false }).limit(100);
  app.chats = (data ?? []) as Chat[];
}
export async function loadLocations(): Promise<Location[]> {
  const { data } = await supabase.from('locations').select('*').order('code').limit(5000);
  app.locations = (data ?? []) as Location[];
  return app.locations;
}

export async function boot() {
  const { data } = await supabase.auth.getSession();
  app.session = data.session;
  supabase.auth.onAuthStateChange((_e, s) => {
    const was = !!app.session;
    app.session = s;
    if (s && !was) void loadAll();
  });
  if (app.session) await loadAll();
  app.ready = true;
}

export async function loadAll() {
  await Promise.all([loadDatasets(), loadChats(), loadLocations(), loadDocStats()]);
}

export async function logout() {
  await supabase.auth.signOut();
  app.session = null;
  app.datasets = []; app.chats = []; app.locations = [];
}
