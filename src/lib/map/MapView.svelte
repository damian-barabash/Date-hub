<script lang="ts" module>
  export interface MapPoint {
    code: string;
    lat: number;
    lng: number;
    title: string;
    subtitle?: string;
    size: number;        // метрика размера
    color?: number;      // метрика цвета (например маржа 0..1)
    rows?: [string, string][]; // строки попапа
    approx?: boolean;
  }
</script>

<script lang="ts">
  // Стилизованная карта Польши (MapLibre + векторные тайлы OpenFreeMap, перекраска под тему).
  // Точки «вырастают» при загрузке, мягкая пульсация, попап в стиле приложения.
  import { onDestroy, onMount } from 'svelte';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { gColor, mix } from '../charts/theme';

  let {
    points = [],
    height = 520,
    group = 'locations',
    colorScale = 'margin',
    detailHref = undefined,
    interactive = true,
  }: {
    points: MapPoint[];
    height?: number | string;
    group?: string;
    colorScale?: 'margin' | 'group' | 'value';
    detailHref?: (code: string) => string;
    interactive?: boolean;
  } = $props();

  let el: HTMLDivElement;
  let map: any = null;
  let maplibre: any = null;
  let ready = $state(false);
  let popup: any = null;

  function geojson(pts: MapPoint[]) {
    const max = Math.max(1, ...pts.map((p) => p.size || 0));
    // цвет — относительно разброса в сети (5–95 перцентиль), иначе все точки одного оттенка
    const cs = pts.map((p) => p.color).filter((v): v is number => typeof v === 'number').sort((x, y) => x - y);
    const lo = cs[Math.floor(cs.length * 0.05)] ?? 0, hi = cs[Math.floor(cs.length * 0.95)] ?? 1;
    const norm = (v?: number) => (typeof v !== 'number' ? 0.5 : v < 0 ? 0 : Math.max(0.05, Math.min(1, (v - lo) / Math.max(hi - lo, 1e-9))));
    return {
      type: 'FeatureCollection',
      features: pts.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).map((p, i) => ({
        type: 'Feature', id: i,
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { code: p.code, s: Math.sqrt(Math.max(p.size, 0) / max), c: norm(p.color), approx: p.approx ? 1 : 0 },
      })),
    };
  }

  function recolor(style: any) {
    const main = gColor(group);
    for (const l of style.layers) {
      const id: string = l.id;
      const p = (l.paint ??= {});
      if (l.type === 'background') p['background-color'] = '#111114';
      else if (l.type === 'fill') {
        if (/water|ocean|sea|lake/.test(id)) p['fill-color'] = '#0b1620';
        else if (/park|wood|grass|landcover|landuse|forest/.test(id)) { p['fill-color'] = '#141a16'; p['fill-opacity'] = 0.55; }
        else if (/building/.test(id)) { p['fill-color'] = '#1c1c21'; }
        else p['fill-color'] = '#131316';
      } else if (l.type === 'line') {
        if (/boundary|admin/.test(id)) { p['line-color'] = /country|_2|level_2|admin_0/.test(id) ? mix(main, '#111114', 0.35) : '#34343c'; }
        else if (/water|river|waterway/.test(id)) p['line-color'] = '#10202c';
        else if (/motorway|trunk/.test(id)) p['line-color'] = '#3a3a44';
        else if (/primary|secondary/.test(id)) p['line-color'] = '#2c2c34';
        else p['line-color'] = '#222228';
      } else if (l.type === 'symbol') {
        if (p['text-color'] !== undefined || l.layout?.['text-field']) {
          p['text-color'] = /place|city|town|country|state/.test(id) ? '#a1a1aa' : '#6b6b74';
          p['text-halo-color'] = '#0a0a0b';
          p['text-halo-width'] = 1.4;
          if (l.layout?.['text-field']) l.layout['text-field'] = ['coalesce', ['get', 'name:pl'], ['get', 'name']];
        }
        if (/poi|shield|transit|airport|housenumber/.test(id)) l.layout = { ...(l.layout ?? {}), visibility: 'none' };
      } else if (l.type === 'fill-extrusion') {
        p['fill-extrusion-color'] = '#151518';
      }
    }
    return style;
  }

  function colorExpr(): any {
    const main = gColor(group);
    if (colorScale === 'group') return main;
    if (colorScale === 'value') return ['interpolate', ['linear'], ['get', 's'], 0, mix(main, '#0a0a0b', 0.45), 1, mix(main, '#ffffff', 0.3)];
    // маржа: красный → янтарный → лайм
    return ['interpolate', ['linear'], ['get', 'c'], 0, '#ef6461', 0.25, '#f08556', 0.6, '#ece8e1', 1, '#7fd1a3'];
  }

  function fit() {
    const pts = points.filter((p) => Number.isFinite(p.lat));
    if (!map || !pts.length) return;
    const b = new maplibre.LngLatBounds();
    pts.forEach((p) => b.extend([p.lng, p.lat]));
    map.fitBounds(b, { padding: 48, duration: 1600, maxZoom: 9 });
  }

  function update() {
    if (!map || !ready) return;
    const src = map.getSource('pts');
    if (src) src.setData(geojson(points));
    map.setPaintProperty('pts', 'circle-color', colorExpr());
    map.setPaintProperty('halo', 'circle-color', colorExpr());
  }

  onMount(() => {
    let disposed = false;
    (async () => {
      const [mod, worker]: any = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl-worker.mjs?url')]);
      maplibre = mod.default ?? mod;
      // воркер MapLibre подключаем явно: Vite переносит модуль, и путь «рядом с собой» ломается
      if (maplibre.getWorkerUrl?.() !== worker.default) maplibre.setWorkerUrl(worker.default);
      const style = recolor(await (await fetch('https://tiles.openfreemap.org/styles/dark')).json());
      if (disposed) return;
      map = new maplibre.Map({
        container: el, style, center: [19.2, 52.1], zoom: 5.3, minZoom: 4, maxZoom: 16,
        attributionControl: { compact: true }, interactive, cooperativeGestures: false, fadeDuration: 0,
      });
      if (interactive) map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      map.on('load', () => {
        map.addSource('pts', { type: 'geojson', data: geojson(points) });
        // ореол
        map.addLayer({ id: 'halo', type: 'circle', source: 'pts', paint: {
          'circle-radius': 0, 'circle-color': colorExpr(), 'circle-opacity': 0.16, 'circle-blur': 0.6,
          'circle-radius-transition': { duration: 1600, delay: 300 },
        } });
        map.addLayer({ id: 'pts', type: 'circle', source: 'pts', paint: {
          'circle-radius': 0, 'circle-color': colorExpr(),
          'circle-stroke-color': '#0a0a0b', 'circle-stroke-width': 1, 'circle-opacity': ['case', ['==', ['get', 'approx'], 1], 0.65, 0.95],
          'circle-radius-transition': { duration: 1200, delay: 200 },
        } });
        ready = true;
        // анимация «вырастания» точек
        requestAnimationFrame(() => {
          map.setPaintProperty('pts', 'circle-radius', ['interpolate', ['linear'], ['zoom'], 4, ['+', 2, ['*', ['get', 's'], 4]], 8, ['+', 4, ['*', ['get', 's'], 10]], 12, ['+', 7, ['*', ['get', 's'], 16]]]);
          map.setPaintProperty('halo', 'circle-radius', ['interpolate', ['linear'], ['zoom'], 4, ['+', 4, ['*', ['get', 's'], 8]], 8, ['+', 9, ['*', ['get', 's'], 20]]]);
        });
        // мягкая пульсация ореола
        let t = 0; let raf = 0;
        const pulse = () => { t += 0.02; if (map?.getLayer('halo')) map.setPaintProperty('halo', 'circle-opacity', 0.1 + Math.abs(Math.sin(t)) * 0.12); raf = requestAnimationFrame(pulse); };
        setTimeout(() => { raf = requestAnimationFrame(pulse); }, 1800);
        map.once('remove', () => cancelAnimationFrame(raf));
        fit();

        if (interactive) {
          map.on('mouseenter', 'pts', () => (map.getCanvas().style.cursor = 'pointer'));
          map.on('mouseleave', 'pts', () => (map.getCanvas().style.cursor = ''));
          map.on('click', 'pts', (e: any) => {
            const code = e.features?.[0]?.properties?.code;
            const p = points.find((x) => x.code === code);
            if (!p) return;
            popup?.remove();
            const rows = (p.rows ?? []).map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:18px;font-size:12.5px;padding:3px 0"><span style="color:#71717a">${k}</span><b style="font-weight:700">${v}</b></div>`).join('');
            const link = detailHref ? `<a href="${detailHref(p.code)}" style="display:block;margin-top:12px;text-align:center;padding:9px;border-radius:999px;background:${gColor(group)};color:#0a0a0b;font-weight:800;font-size:12.5px;text-decoration:none">Szczegóły →</a>` : '';
            popup = new maplibre.Popup({ offset: 14, maxWidth: '300px' })
              .setLngLat([p.lng, p.lat])
              .setHTML(`<div style="min-width:220px"><div style="font-weight:800;font-size:14px;letter-spacing:-.01em">${p.title}</div>${p.subtitle ? `<div style="color:#71717a;font-size:12px;margin:2px 0 10px">${p.subtitle}</div>` : ''}${rows}${p.approx ? '<div style="color:#dcc3a1;font-size:11px;margin-top:6px">≈ lokalizacja przybliżona</div>' : ''}${link}</div>`)
              .addTo(map);
            map.easeTo({ center: [p.lng, p.lat], duration: 700 });
          });
        }
      });
    })();
    return () => { disposed = true; };
  });

  $effect(() => {
    void points; void colorScale;
    update();
  });

  export function flyTo(code: string) {
    const p = points.find((x) => x.code === code);
    if (p && map) map.flyTo({ center: [p.lng, p.lat], zoom: 11, speed: 1.2, curve: 1.6 });
  }

  onDestroy(() => { popup?.remove(); map?.remove(); map = null; });
</script>

<div class="relative w-full overflow-hidden rounded-[18px]" style="height:{typeof height === 'number' ? `${height}px` : height}">
  <div bind:this={el} style="position:absolute; inset:0; width:100%; height:100%"></div>
  {#if !ready}<div class="skeleton absolute inset-0"></div>{/if}
</div>
