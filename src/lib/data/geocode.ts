// Геокодирование адресов точек в браузере (Nominatim / OpenStreetMap, 1 запрос в секунду).
// Из облачных IP OSM отвечает медленно и часто отказывает, поэтому адреса ищем отсюда,
// а разбор «кодов» без адреса (GLI-DWORCOWA47) делает ИИ в edge function «geo».
import { supabase, fn } from '../supabase';
import type { Location } from '../stores/app.svelte';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;

async function nominatim(params: Record<string, string>): Promise<any | null> {
  const wait = 1100 - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const u = new URL('https://nominatim.openstreetmap.org/search');
  for (const [k, v] of Object.entries({ format: 'jsonv2', addressdetails: '1', limit: '1', countrycodes: 'pl', 'accept-language': 'pl', ...params })) u.searchParams.set(k, v);
  try {
    const res = await fetch(u);
    if (!res.ok) return null;
    return (await res.json())?.[0] ?? null;
  } catch { return null; }
}

/** «Galeria Veneda- ul. Zawadzka 38/U3» → { place: 'Galeria Veneda', street: 'Zawadzka 38' } */
export function splitAddress(raw: string | null): { place: string | null; street: string | null } {
  if (!raw) return { place: null, street: null };
  let s = raw.replace(/\s+/g, ' ').trim();
  let place: string | null = null;
  const m = s.match(/^(.*?)[\s,–-]*\b(ul\.|ulica|al\.|aleja|aleje|pl\.|plac|os\.|osiedle|rondo)\s*(.+)$/i);
  if (m) {
    place = m[1].replace(/[\s,–-]+$/, '').trim() || null;
    s = m[3];
  }
  s = s.replace(/\s*\/.*$/, '').replace(/\s*(lok\.|lokal|paw\.|pawilon|box|stoisko|wyspa|nr lok).*$/i, '').replace(/,.*$/, '').trim();
  return { place, street: s || null };
}

const region = (a: any) => String(a?.state ?? '').replace(/^województwo\s+/i, '') || null;

export async function geocodeOne(l: Location): Promise<Partial<Location> & { status: string }> {
  const { place, street } = splitAddress(l.street);
  const city = l.city ?? '';
  const postal = (l.postal ?? '').trim();
  let hit: any = null; let status = 'ok';
  if (street && city) hit = await nominatim({ street, city, ...(postal ? { postalcode: postal } : {}) });
  if (!hit && street && city) hit = await nominatim({ street, city });
  if (!hit && place && city) hit = await nominatim({ q: `${place}, ${city}` });
  if (!hit && l.note && city) hit = await nominatim({ q: `${l.note}, ${city}` });
  if (!hit && city) {
    status = 'approx';
    hit = postal ? await nominatim({ postalcode: postal, city }) : null;
    hit ??= await nominatim({ city });
  }
  if (!hit) return { status: 'failed' };
  const j = status === 'approx' ? () => (Math.random() - 0.5) * 0.008 : () => 0;
  return { lat: Number(hit.lat) + j(), lng: Number(hit.lon) + j(), region: region(hit.address) ?? l.region, postal: l.postal ?? hit.address?.postcode ?? null, status };
}

/**
 * Полный проход: 1) ИИ разбирает коды без адреса, 2) браузер геокодирует адреса.
 * onProgress(осталось, всего). Возвращает число обработанных точек.
 */
export async function geocodeAll(load: () => Promise<Location[]>, onProgress?: (left: number, total: number) => void, signal?: { stop: boolean }): Promise<number> {
  let locs = await load();
  // 1) коды без города → ИИ
  for (let i = 0; i < 10 && locs.some((l) => l.status === 'pending' && !l.city); i++) {
    await fn('geo', { action: 'parse' });
    locs = await load();
  }
  const todo = locs.filter((l) => l.status === 'pending' && l.city);
  let done = 0;
  for (const l of todo) {
    if (signal?.stop) break;
    onProgress?.(todo.length - done, todo.length);
    const r = await geocodeOne(l);
    await supabase.from('locations').update({ ...r, updated_at: new Date().toISOString() }).eq('code', l.code);
    done++;
  }
  onProgress?.(0, todo.length);
  await load();
  return done;
}
