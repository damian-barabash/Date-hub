import type { Session } from '@supabase/supabase-js';
import { fn, getWorkspace, setWorkspace, supabase } from '../supabase';
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

export interface Workspace { id: string; name: string }

export const app = $state({
  session: null as Session | null,
  workspaces: [] as Workspace[],
  ws: null as string | null,
  isAdmin: false,
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

/** Воркспейсы пользователя; текущий — сохранённый, иначе первый доступный. */
export async function loadWorkspaces() {
  try {
    const r = await fn<{ admin: boolean; workspaces: Workspace[] }>('users', { action: 'my_workspaces' });
    app.workspaces = r.workspaces; app.isAdmin = r.admin;
  } catch { app.workspaces = []; app.isAdmin = false; }
  const saved = getWorkspace();
  const id = app.workspaces.find((w) => w.id === saved)?.id ?? app.workspaces[0]?.id ?? null;
  setWorkspace(id); app.ws = id;
}
export const currentWs = () => app.workspaces.find((w) => w.id === app.ws) ?? null;

/** Переключение: сохраняем и перезагружаем приложение — ни одно состояние прежнего воркспейса не остаётся в памяти. */
export function switchWorkspace(id: string) {
  if (id === app.ws) return;
  setWorkspace(id);
  location.hash = '#/';
  location.reload();
}

let geoRunning = false;
/** Адреса точек без координат дорабатываются в фоне при каждом входе — пока не найдены все. */
function resumeGeocoding() {
  if (geoRunning || !app.locations.some((l) => l.status === 'pending')) return;
  geoRunning = true;
  import('../data/geocode').then((m) => m.geocodeAll(loadLocations, (_left, _t) => undefined)).catch(() => null).finally(() => { geoRunning = false; void loadLocations(); });
}

export async function loadAll() {
  await loadWorkspaces();
  await Promise.all([loadDatasets(), loadChats(), loadLocations(), loadDocStats()]);
  resumeGeocoding();
}

export async function logout() {
  await supabase.auth.signOut();
  app.session = null;
  app.datasets = []; app.chats = []; app.locations = [];
}
