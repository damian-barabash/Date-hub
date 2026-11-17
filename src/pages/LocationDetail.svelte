<script lang="ts">
  import { active, app } from '../lib/stores/app.svelte';
  import { agg, rolesOf, stdMetrics, type Row } from '../lib/data/api';
  import { load } from '../lib/data/load.svelte';
  import { toPoints } from '../lib/data/geo';
  import { t, tr } from '../lib/i18n.svelte';
  import { go, href, route } from '../lib/router.svelte';
  import { pct, pln } from '../lib/format';
  import PageHeader from '../lib/ui/PageHeader.svelte';
  import Kpi from '../lib/ui/Kpi.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Empty from '../lib/ui/Empty.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Chart from '../lib/charts/Chart.svelte';
  import MapView from '../lib/map/MapView.svelte';

  const ds = $derived(active());
  const R = $derived(ds ? rolesOf(ds) : null);
  const code = $derived(decodeURIComponent(route.parts[1] ?? ''));
  const loc = $derived(app.locations.find((l) => l.code === code));

  const s = load(async (d) => {
    const { r, revenue } = rolesOf(d);
    const c = code;
    if (!r.location || !c) return null;
    const f = [{ col: r.location, op: 'eq', val: c }];
    const ord = [{ by: revenue ? 'revenue' : 'records', dir: 'desc' as const }];
    const [[tot], network, cats, prods, worst] = await Promise.all([
      agg(d, { metrics: stdMetrics(d, [
        ...(r.manager ? [{ fn: 'mode', col: r.manager, as: 'manager' }] : []),
        ...(r.product_id || r.product ? [{ fn: 'count_distinct', col: (r.product_id ?? r.product)!, as: 'products' }] : []),
      ]), filters: f }),
      agg(d, { metrics: stdMetrics(d, [{ fn: 'count_distinct', col: r.location, as: 'points' }]) }),
      r.category ? agg(d, { group: [r.category], metrics: stdMetrics(d), filters: f, order: ord, limit: 12 }) : Promise.resolve([] as Row[]),
      r.product ? agg(d, { group: [r.product], metrics: stdMetrics(d), filters: f, order: ord, limit: 12 }) : Promise.resolve([] as Row[]),
      r.product && r.margin ? agg(d, { group: [r.product], metrics: stdMetrics(d), filters: [...f, { col: r.margin, op: 'lt', val: 0.1 }], order: ord, limit: 8 }) : Promise.resolve([] as Row[]),
    ]);
    return { tot, avg: network[0], cats, prods, worst };
  });
  const tot = $derived(s.data?.tot ?? {});
  const avgRev = $derived(s.data?.avg ? s.data.avg.revenue / Math.max(s.data.avg.points, 1) : null);
</script>

{#if !ds}<Empty />
{:else}
  <PageHeader title={loc?.name?.replace(/\s+/g, ' ') || code} sub={[code, loc?.street, loc?.postal, loc?.city].filter(Boolean).join(' · ')}>
    <button class="pill" onclick={() => (history.length > 1 ? history.back() : go('/locations'))}><Icon name="left" size={14} />{t('common.back')}</button>
    <button class="pill pill-accent" data-group="locations" onclick={() => go(`/chat?q=${encodeURIComponent(tr(`Przeanalizuj punkt ${code}: wyniki na tle sieci, najlepsze i najgorsze produkty, rekomendacje`, `Analyse point ${code}: results vs network, best and worst products, recommendations`))}`)}><Icon name="ask" size={15} />{tr('Analiza AI', 'AI analysis')}</button>
  </PageHeader>

  <div class="mb-4 flex flex-wrap gap-2 rise" style="--i:1">
    {#if tot.manager}<a class="pill pill-sm" data-group="managers" href={href(`/managers/${encodeURIComponent(tot.manager)}`)}>{tot.manager}</a>{/if}
    {#if loc?.region}<span class="pill pill-sm" data-group="locations">{loc.region}</span>{/if}
    {#if loc?.branch}<span class="pill pill-sm">{tr('Oddział', 'Branch')} {loc.branch}</span>{/if}
    {#if loc?.kind}<span class="pill pill-sm">{loc.kind}</span>{/if}
    {#if loc?.email}<a class="pill pill-sm" href="mailto:{loc.email}"><Icon name="chat" size={13} />{loc.email}</a>{/if}
  </div>

  <div class="kpis">
    <Kpi i={0} label={t('kpi.revenue')} value={tot.revenue ?? null} format="pln" icon="coins" group="finance" loading={s.loading} hint="{tr('średnia punktu w sieci', 'network avg per point')}: {pln(avgRev, true)}" />
    {#if R?.has('profit')}<Kpi i={1} label={t('kpi.profit')} value={tot.profit ?? null} format="pln" icon="trendUp" group="finance" loading={s.loading} />{/if}
    {#if tot.margin !== undefined}<Kpi i={2} label={t('kpi.margin')} value={tot.margin ?? null} format="pct" icon="percent" group="products" loading={s.loading} hint="{tr('sieć', 'network')}: {pct(s.data?.avg?.margin)}" />{/if}
    <Kpi i={3} label={t('kpi.products')} value={tot.products ?? null} format="int" compact={false} icon="box" group="products" loading={s.loading} />
  </div>

  <div class="mt-4 grid gap-4 xl:grid-cols-3">
    <Panel class="xl:col-span-2" title={t('loc.topProducts')} icon="box" group="products" i={1}>
      <Chart height={400} rows={s.data?.prods ?? []} spec={{ chart: 'bar', x: R?.r.product, y: R?.has('profit') ? ['revenue', 'profit'] : ['revenue'], horizontal: true, format: 'pln', group: 'products', labels: { revenue: t('kpi.revenue'), profit: t('kpi.profit') } }} />
    </Panel>
    <Panel title={t('loc.categories')} icon="layers" group="products" i={2}>
      <Chart height={400} rows={s.data?.cats ?? []} spec={{ chart: 'donut', name: R?.r.category, value: 'revenue', format: 'pln', group: 'products' }} />
    </Panel>
  </div>
  <div class="mt-4 grid gap-4 xl:grid-cols-2">
    {#if loc?.lat}
      <Panel title={t('nav.map')} icon="map" group="locations" i={3}>
        <MapView points={toPoints([{ loc: code, ...tot }], app.locations)} height={340} />
      </Panel>
    {/if}
    {#if (s.data?.worst ?? []).length}
      <Panel title={tr('Niska marża (< 10%)', 'Low margin (< 10%)')} icon="alert" group="alerts" i={4}>
        <div class="space-y-2">
          {#each s.data?.worst ?? [] as p, i}
            <div class="flex items-center justify-between gap-3 rounded-xl bg-white/[0.025] px-4 py-3 rise" style="--i:{i}">
              <span class="truncate text-[13px] font-semibold">{p[R?.r.product ?? '']}</span>
              <span class="flex shrink-0 items-center gap-3 text-[12.5px]"><span class="faint num">{pln(p.revenue, true)}</span><span class="badge num">{pct(p.margin)}</span></span>
            </div>
          {/each}
        </div>
      </Panel>
    {/if}
  </div>
{/if}
