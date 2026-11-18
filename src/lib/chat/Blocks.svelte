<script lang="ts">
  // Визуальные блоки ответа ИИ / отчёта: графики (2D/3D), 3D-сеть, карта, KPI, таблица, текст, выноски.
  // Каждый блок появляется по очереди (stagger), графики анимируются сами.
  import Chart from '../charts/Chart.svelte';
  import Network3D from '../charts/Network3D.svelte';
  import MapView from '../map/MapView.svelte';
  import Kpi from '../ui/Kpi.svelte';
  import Icon from '../ui/Icon.svelte';
  import Markdown from './Markdown.svelte';
  import { KIND_ALIASES, type ChartSpec, type Kind } from '../charts/spec';
  import { app } from '../stores/app.svelte';
  import { fmt, pct, pln } from '../format';
  import { csvDownload } from '../data/api';
  import { href } from '../router.svelte';

  import type { Snippet } from 'svelte';
  // tools — панель правки блока (дашборды вкладок): (индекс, блок) → кнопки
  let { blocks = [], results = {}, baseDelay = 0, compact = false, limit = Infinity, tools }:
    { blocks: any[]; results: Record<string, { columns: string[]; rows: Record<string, any>[] }>; baseDelay?: number; compact?: boolean; limit?: number; tools?: Snippet<[number, any]> } = $props();

  const KINDS = new Set<string>(['bar', 'line', 'area', 'waterfall', 'pie', 'donut', 'rose', 'funnel', 'treemap', 'sunburst', 'scatter', 'bubble', 'heatmap', 'radar', 'gauge', 'sankey', 'graph', 'bar3d', 'scatter3d', 'surface3d', 'network3d', 'map']);

  // нормализация: модель иногда пишет {type:"bar3d"} вместо {type:"chart", chart:"bar3d"}
  function norm(b: any): any {
    let type = String(b.type ?? '').toLowerCase();
    let chart = String(b.chart ?? '').toLowerCase();
    if (type !== 'chart' && (KINDS.has(type) || KIND_ALIASES[type])) { chart = type; type = 'chart'; }
    if (type === 'chart') {
      chart = KIND_ALIASES[chart] ?? chart;
      if (b.chart === 'hbar' || b.type === 'hbar') b.horizontal = true;
      if (!KINDS.has(chart)) chart = 'bar';
    }
    return { ...b, type, chart };
  }
  const list = $derived(blocks.map(norm));
  const ysOf = (b: any): string[] => (Array.isArray(b.y) ? b.y : b.y ? [b.y] : []);
  /** Горизонтальный рейтинг с одной серией: по убыванию, чтобы порядок читался сразу. */
  function barRows(b: any, rows: Record<string, any>[]) {
    if (b.chart !== 'bar' || !b.horizontal || b.series || ysOf(b).length !== 1) return rows;
    const k = ysOf(b)[0];
    if (!rows.every((r) => typeof r[k] === 'number')) return rows;
    return [...rows].sort((p, q) => q[k] - p[k]);
  }
  /** Высота растёт с числом строк: у каждой строки своя «полка» и воздух, подписи не слипаются. */
  function barHeight(b: any, rows: Record<string, any>[]) {
    if (b.chart !== 'bar' || !b.horizontal) return tall(b.chart);
    const cats = b.series ? new Set(rows.map((r) => r[b.x])).size : rows.length;
    const series = b.series ? (b.stack ? 1 : new Set(rows.map((r) => r[b.series])).size) : b.stack ? 1 : Math.max(ysOf(b).length, 1);
    return Math.max(280, cats * (18 + Math.min(series, 4) * 16) + (series > 1 ? 70 : 30));
  }
  const tall = (k: Kind) => (k === 'network3d' ? 580 : ['bar3d', 'scatter3d', 'surface3d', 'map', 'treemap', 'sankey', 'graph', 'sunburst'].includes(k) ? 460 : k === 'gauge' ? 260 : 360);

  function mapPoints(b: any, rows: Record<string, any>[]) {
    const nameCol = b.name ?? b.x ?? Object.keys(rows[0] ?? {})[0];
    const valCol = b.value ?? (Array.isArray(b.y) ? b.y[0] : b.y) ?? Object.keys(rows[0] ?? {}).find((k) => typeof rows[0][k] === 'number');
    const byCode = new Map(app.locations.map((l) => [l.code, l]));
    return rows.map((r) => {
      const l = byCode.get(String(r[nameCol]));
      if (!l?.lat || !l?.lng) return null;
      return {
        code: l.code, lat: l.lat, lng: l.lng, title: l.name || l.code, subtitle: [l.code, l.city].filter(Boolean).join(' · '),
        size: Number(r[valCol]) || 1, color: typeof r.marza === 'number' ? r.marza : typeof r.margin === 'number' ? r.margin : undefined,
        rows: Object.entries(r).filter(([k]) => k !== nameCol).slice(0, 6).map(([k, v]) => [k.replace(/_/g, ' '), typeof v === 'number' ? (/marz|margin/i.test(k) ? pct(v) : Math.abs(v) > 999 ? pln(v, true) : String(v)) : String(v ?? '—')] as [string, string]),
        approx: l.status === 'approx',
      };
    }).filter(Boolean) as any[];
  }
</script>

<div class="grid gap-3 {compact ? '' : 'md:grid-cols-2'}">
  {#each list.slice(0, limit) as b, i}
    {@const res = b.q ? results[b.q] : Array.isArray(b.data) && b.data.length ? { columns: Object.keys(b.data[0]), rows: b.data as Record<string, any>[] } : null}
    {@const wide = compact || b.type === 'kpis' || b.type === 'text' || b.type === 'callout' || b.type === 'table' || ['bar3d', 'scatter3d', 'surface3d', 'network3d', 'map', 'treemap', 'sankey', 'graph', 'heatmap'].includes(b.chart) || list.filter((x) => x.type === 'chart').length === 1}
    <div class="rise relative min-w-0 {wide ? 'md:col-span-2' : ''} {tools ? 'block-edit' : ''}" style="--i:{i}; animation-delay:{limit === Infinity ? baseDelay + i * 220 : 0}ms" data-group={b.group ?? 'ai'}>
      {#if tools}<div class="block-tools">{@render tools(i, blocks[i])}</div>{/if}
      {#if b.type === 'kpis'}
        <div class="grid grid-cols-2 gap-3 {b.items?.length > 3 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}">
          {#each b.items ?? [] as k, j}
            <Kpi i={j} label={k.label} text={typeof k.value !== 'number' && isNaN(Number(k.value)) ? String(k.value ?? '—') : ''} value={typeof k.value === 'number' ? k.value : Number(k.value) || 0} format={k.format ?? 'num'} hint={k.hint ?? ''} group={k.group ?? b.group ?? 'ai'} />
          {/each}
        </div>
      {:else if b.type === 'callout'}
        <div class="flex gap-3 rounded-2xl border p-4" data-group={b.tone === 'warn' ? 'alerts' : b.tone === 'good' ? 'finance' : 'ai'}
          style="border-color:var(--color-line-2); background:rgb(255 255 255 / 0.02)">
          <span class={b.tone === 'warn' ? 'text-[#f04438]' : 'faint'}><Icon name={b.tone === 'warn' ? 'alert' : b.tone === 'good' ? 'check' : 'bolt'} size={18} /></span>
          <Markdown text={b.md ?? ''} />
        </div>
      {:else if b.type === 'text'}
        <div class="px-1"><Markdown text={b.md ?? ''} /></div>
      {:else if b.type === 'table' && res}
        {@const cols = b.columns?.length ? b.columns.filter((c: string) => res.columns.includes(c)) : res.columns}
        <div class="card card-pad">
          <div class="mb-3 flex items-center justify-between gap-2">
            <div class="card-title">{b.title ?? ''}</div>
            <button class="pill pill-sm" onclick={() => csvDownload(b.title ?? 'dane', res.rows)}><Icon name="download" size={13} />CSV</button>
          </div>
          <div class="max-h-[420px] overflow-auto">
            <table class="table">
              <thead><tr>{#each cols as c}<th>{c.replace(/_/g, ' ')}</th>{/each}</tr></thead>
              <tbody>
                {#each res.rows.slice(0, 200) as r}
                  <tr>{#each cols as c}<td class:r={typeof r[c] === 'number'} class="num">{typeof r[c] === 'number' ? (/marz|margin|udzial|share/i.test(c) && Math.abs(r[c]) <= 1.5 ? pct(r[c]) : fmt(r[c], Number.isInteger(r[c]) ? 'int' : 'num')) : r[c] ?? '—'}</td>{/each}</tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {:else if b.type === 'chart' && res}
        <div class="card card-pad">
          <div class="mb-2 flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="card-title">{b.title ?? ''}</div>
              {#if b.subtitle}<div class="card-sub">{b.subtitle}</div>{/if}
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              {#if ['bar3d', 'scatter3d', 'surface3d', 'network3d'].includes(b.chart)}<span class="badge">3D</span>{/if}
              <button class="icon-btn !h-8 !w-8" title="CSV" onclick={() => csvDownload(b.title ?? 'dane', res.rows)}><Icon name="download" size={14} /></button>
            </div>
          </div>
          {#if b.chart === 'network3d'}
            <Network3D rows={res.rows} source={b.source ?? res.columns[0]} target={b.target ?? res.columns[1]} value={b.value ?? res.columns[2]} group={b.group} format={b.format} height={tall('network3d')} />
          {:else if b.chart === 'map'}
            <MapView points={mapPoints(b, res.rows)} height={tall('map')} colorScale={res.rows.some((r: Record<string, any>) => 'marza' in r || 'margin' in r) ? 'margin' : 'value'} group={b.group ?? 'locations'} detailHref={(c) => href(`/locations/${encodeURIComponent(c)}`)} />
          {:else}
            {@const br = barRows(b, res.rows)}
            <Chart height={barHeight(b, br)} rows={br} spec={b as ChartSpec} />
          {/if}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .block-tools { position: absolute; top: -12px; left: 18px; z-index: 5; display: flex; gap: 4px; padding: 3px; border-radius: 999px;
    background: #17171a; border: 1px solid rgb(255 255 255 / 0.1); box-shadow: 0 6px 24px rgb(0 0 0 / 0.45);
    opacity: 0; transform: translateY(4px); transition: opacity .2s, transform .2s; }
  .block-edit:hover .block-tools, .block-edit:focus-within .block-tools { opacity: 1; transform: none; }
  @media (hover: none) { .block-tools { opacity: 1; transform: none; } }
</style>
