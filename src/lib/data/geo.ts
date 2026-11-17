import type { MapPoint } from '../map/MapView.svelte';
import type { Location } from '../stores/app.svelte';
import { pct, pln, int } from '../format';
import type { Row } from './api';

/** Точки карты: агрегаты по колонке-локации + справочник public.locations. */
export function toPoints(rows: Row[], locs: Location[], key = 'loc'): MapPoint[] {
  const byCode = new Map(locs.map((l) => [l.code, l]));
  const out: MapPoint[] = [];
  for (const r of rows) {
    const l = byCode.get(String(r[key]));
    if (!l || l.lat === null || l.lng === null) continue;
    const rowsInfo: [string, string][] = [];
    if (r.manager) rowsInfo.push(['Kierownik', String(r.manager)]);
    if (l.region) rowsInfo.push(['Województwo', l.region]);
    if (l.kind) rowsInfo.push(['Rodzaj', l.kind]);
    if (r.revenue !== undefined) rowsInfo.push(['Przychód', pln(r.revenue, true)]);
    if (r.profit !== undefined) rowsInfo.push(['Zysk', pln(r.profit, true)]);
    if (r.margin !== undefined) rowsInfo.push(['Marża', pct(r.margin)]);
    if (r.products !== undefined) rowsInfo.push(['Produkty', int(r.products)]);
    out.push({
      code: l.code, lat: l.lat, lng: l.lng,
      title: l.name?.replace(/\s+/g, ' ') || l.code,
      subtitle: [l.code, [l.street, l.city].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
      size: Number(r.revenue ?? r.records ?? 1), color: typeof r.margin === 'number' ? r.margin : undefined,
      rows: rowsInfo, approx: l.status === 'approx',
    });
  }
  return out;
}
