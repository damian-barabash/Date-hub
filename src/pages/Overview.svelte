<script lang="ts">
  import { active, app } from '../lib/stores/app.svelte';
  import { agg, hist, rolesOf, stdMetrics, type Row } from '../lib/data/api';
  import { load } from '../lib/data/load.svelte';
  import { toPoints } from '../lib/data/geo';
  import { t, tr } from '../lib/i18n.svelte';
  import { go, href } from '../lib/router.svelte';
  import { pct, int } from '../lib/format';
  import PageHeader from '../lib/ui/PageHeader.svelte';
  import Kpi from '../lib/ui/Kpi.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Empty from '../lib/ui/Empty.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Chart from '../lib/charts/Chart.svelte';
  import MapView from '../lib/map/MapView.svelte';

  const ds = $derived(active());

  const s = load(async (d) => {
    const { r, revenue } = rolesOf(d);
    const extra = [
      ...(r.location ? [{ fn: 'count_distinct', col: r.location, as: 'locations' }] : []),
      ...(r.manager ? [{ fn: 'count_distinct', col: r.manager, as: 'managers' }] : []),
      ...(r.product_id || r.product ? [{ fn: 'count_distinct', col: (r.product_id ?? r.product)!, as: 'products' }] : []),
      ...(r.margin ? [{ fn: 'count_lt', col: r.margin, val: 0, as: 'neg' }, { fn: 'count_lt', col: r.margin, val: 0.1, as: 'low' }] : []),
      ...(revenue ? [{ fn: 'count_lt', col: revenue, val: 0, as: 'returns' }] : []),
    ];
    const [tot] = await agg(d, { metrics: stdMetrics(d, extra) });
    const by = (col?: string, limit = 12) => col ? agg(d, { group: [col], metrics: stdMetrics(d), order: [{ by: revenue ? 'revenue' : 'records', dir: 'desc' }], limit }) : Promise.resolve([] as Row[]);
    const [managers, cats, locs, mdist, tree] = await Promise.all([
      by(r.manager, 12),
      by(r.category, 10),
      r.location ? agg(d, { group: [r.location], metrics: stdMetrics(d, r.manager ? [{ fn: 'mode', col: r.manager, as: 'manager' }] : []), order: [{ by: revenue ? 'revenue' : 'records', dir: 'desc' }], limit: 2000 }) : Promise.resolve([] as Row[]),
      r.margin ? hist(d, r.margin, [-1e9, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 1.0001]) : Promise.resolve([]),
      r.manager && r.category && revenue ? agg(d, { group: [r.manager, r.category], metrics: [{ fn: 'sum', col: revenue, as: 'revenue' }], order: [{ by: 'revenue', dir: 'desc' }], limit: 400 }) : Promise.resolve([] as Row[]),
    ]);
    return { tot, managers, cats, locs: locs.map((x) => ({ ...x, loc: x[r.location!] })), mdist, tree };
  });

  const R = $derived(ds ? rolesOf(ds) : null);
  const tot = $derived(s.data?.tot ?? {});
  const points = $derived(s.data ? toPoints(s.data.locs, app.locations) : []);
  const mdistRows = $derived((s.data?.mdist ?? []).map((b: any) => ({
    bucket: b.lo === null || b.lo < -1e8 ? '< 0%' : b.hi === null || b.hi > 1 ? `${Math.round(b.lo * 100)}%+` : `${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%`, n: b.n,
  })));
</script>

{#if !ds}
  <Empty />
{:else}
  <PageHeader title={t('ov.title')} sub="{t('ov.sub')}{ds.meta?.period ? ` · ${ds.meta.period}` : ''} · {ds.name}">
    <button class="pill" data-group="ai" onclick={() => go(`/chat?q=${encodeURIComponent(tr('Przygotuj pełny raport miesięczny sprzedaży', 'Prepare a full monthly sales report'))}`)}>
      <Icon name="report" size={15} />{t('rep.monthly')}
    </button>
  </PageHeader>

  <div class="kpis">
    {#if R?.revenue}<Kpi hero i={0} label={t('kpi.revenue')} value={tot.revenue ?? null} format="pln" icon="coins" group="finance" loading={s.loading} hint={tot.gross ? `${t('kpi.gross')}: ${new Intl.NumberFormat('pl-PL', { notation: 'compact', maximumFractionDigits: 2 }).format(tot.gross)} zł` : ''} />{/if}
    {#if R?.has('profit')}<Kpi i={1} label={t('kpi.profit')} value={tot.profit ?? null} format="pln" icon="trendUp" group="finance" loading={s.loading} hint={tr('netto × marża', 'net × margin')} />{/if}
    {#if tot.margin !== undefined}<Kpi i={2} label={t('kpi.margin')} value={tot.margin ?? null} format="pct" icon="percent" group="products" loading={s.loading} hint={tr('ważona przychodem', 'revenue-weighted')} />{/if}
    {#if R?.has('qty')}<Kpi i={3} label={t('kpi.qty')} value={tot.qty ?? null} format="int" icon="box" group="products" loading={s.loading} />{/if}
    {#if R?.has('location')}<Kpi i={4} label={t('kpi.locations')} value={tot.locations ?? null} format="int" compact={false} icon="store" group="locations" loading={s.loading} hint="{int(tot.products)} {t('kpi.products').toLowerCase()}" />{/if}
    {#if R?.has('manager')}<Kpi i={5} label={t('kpi.managers')} value={tot.managers ?? null} format="int" compact={false} icon="users" group="managers" loading={s.loading} hint="{int(tot.records)} {t('kpi.records').toLowerCase()}" />{/if}
  </div>

  <div class="mt-4 grid gap-4 xl:grid-cols-3">
    {#if R?.has('manager')}
      <Panel class="xl:col-span-2" title={t('ov.leaderboard')} sub={t('ov.leaderboard.sub')} icon="users" group="managers" i={2}>
        {#snippet actions()}<a class="pill pill-sm" href={href('/managers')}>{t('common.details')}<Icon name="right" size={13} /></a>{/snippet}
        <Chart height={420} rows={s.data?.managers ?? []}
          spec={{ chart: 'bar', x: R.r.manager, y: R.has('profit') ? ['revenue', 'profit'] : ['revenue'], horizontal: true, format: 'pln', group: 'managers', labels: { revenue: t('kpi.revenue'), profit: t('kpi.profit') } }}
          onclick={(p) => go(`/managers/${encodeURIComponent(p.name)}`)} />
      </Panel>
    {/if}

    <Panel title={t('ov.attention')} sub={t('ov.attention.sub')} icon="alert" group="alerts" i={3}>
      <div class="space-y-2">
        {#each [
          { k: t('ov.negMargin'), v: tot.neg, show: R?.has('margin'), q: tr('Pokaż produkty i punkty z ujemną marżą', 'Show products and points with negative margin') },
          { k: t('ov.lowMargin'), v: tot.low, show: R?.has('margin'), q: tr('Które produkty mają marżę poniżej 10%?', 'Which products have margin below 10%?') },
          { k: t('ov.returns'), v: tot.returns, show: !!R?.revenue, q: tr('Przeanalizuj zwroty i korekty (ujemne przychody)', 'Analyse returns and corrections (negative revenue)') },
        ].filter((x) => x.show) as a, i}
          <button class="flex w-full items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5 text-left text-[13.5px] font-semibold transition hover:border-[#ef6461]/40 hover:bg-[#ef6461]/[0.05] rise" style="--i:{i + 4}" onclick={() => go(`/chat?q=${encodeURIComponent(a.q)}`)}>
            {a.k}
            <span class="flex items-center gap-2"><span class="badge num">{int(a.v)}</span><Icon name="ask" size={14} class="faint" /></span>
          </button>
        {/each}
      </div>
      {#if mdistRows.length}
        <div class="mt-5 text-[13px] font-bold">{t('ov.marginDist')}</div>
        <div class="card-sub">{tr('liczba pozycji wg przedziału marży', 'line items by margin bucket')}</div>
        <Chart height={190} rows={mdistRows} spec={{ chart: 'bar', x: 'bucket', y: ['n'], format: 'int', group: 'products' }} />
      {/if}
    </Panel>
  </div>

  <div class="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
    {#if R?.has('category')}
      <Panel title={t('ov.categories')} sub={t('ov.categories.sub')} icon="layers" group="products" i={4}>
        <Chart height={330} rows={s.data?.cats ?? []} spec={{ chart: 'donut', name: R.r.category, value: 'revenue', format: 'pln', group: 'products' }} />
      </Panel>
    {/if}
    {#if R?.has('location')}
      <Panel title={t('ov.topLocations')} sub={tr('Top 10 wg przychodu', 'Top 10 by revenue')} icon="store" group="locations" i={5}>
        {#snippet actions()}<a class="pill pill-sm" href={href('/locations')}>{t('common.details')}<Icon name="right" size={13} /></a>{/snippet}
        <Chart height={330} rows={(s.data?.locs ?? []).slice(0, 10)} spec={{ chart: 'bar', x: 'loc', y: ['revenue'], horizontal: true, format: 'pln', group: 'locations' }}
          onclick={(p) => go(`/locations/${encodeURIComponent(p.name)}`)} />
      </Panel>
      <Panel title={t('ov.mapTeaser')} sub="{points.length} {tr('punktów na mapie', 'points on the map')}" icon="map" group="locations" i={6}>
        {#snippet actions()}<a class="pill pill-sm" href={href('/map')}>{t('nav.map')}<Icon name="right" size={13} /></a>{/snippet}
        <MapView {points} height={330} detailHref={(c) => href(`/locations/${encodeURIComponent(c)}`)} />
      </Panel>
    {/if}
  </div>

  {#if (s.data?.tree ?? []).length}
    <Panel class="mt-4" title={tr('Struktura przychodu', 'Revenue structure')} sub={tr('Kierownik › kategoria · kliknij, aby przybliżyć', 'Manager › category · click to zoom')} icon="grid" group="managers" i={7}>
      <Chart height={460} rows={s.data?.tree ?? []} spec={{ chart: 'treemap', path: [R!.r.manager!, R!.r.category!], value: 'revenue', format: 'pln', group: 'managers' }} />
    </Panel>
  {/if}

  {#if s.error}<div class="mt-4 text-sm text-[#ff8f8f]">{s.error}</div>{/if}
{/if}
