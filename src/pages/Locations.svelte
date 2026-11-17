<script lang="ts">
  import { active, app } from '../lib/stores/app.svelte';
  import { csvDownload, rolesOf, type Row } from '../lib/data/api';
  import { load } from '../lib/data/load.svelte';
  import { locationStats, rollup, withDirectory } from '../lib/data/locs';
  import { t, tr } from '../lib/i18n.svelte';
  import { go, href } from '../lib/router.svelte';
  import { int, pct, pln } from '../lib/format';
  import PageHeader from '../lib/ui/PageHeader.svelte';
  import Kpi from '../lib/ui/Kpi.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Empty from '../lib/ui/Empty.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Chart from '../lib/charts/Chart.svelte';

  const ds = $derived(active());
  const R = $derived(ds ? rolesOf(ds) : null);
  const s = load(locationStats);
  const all = $derived(withDirectory(s.data ?? [], app.locations));

  let q = $state('');
  let fManager = $state('');
  let fKind = $state('');
  let page = $state(0);
  let sort = $state<{ by: string; dir: 1 | -1 }>({ by: 'revenue', dir: -1 });
  const PER = 20;

  const filtered = $derived(all
    .filter((x) => !q || `${x.loc} ${x.name ?? ''} ${x.city} ${x.street ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .filter((x) => !fManager || x.manager === fManager)
    .filter((x) => !fKind || x.kind === fKind)
    .sort((a, b) => ((a[sort.by] ?? 0) > (b[sort.by] ?? 0) ? 1 : -1) * sort.dir));
  const pages = $derived(Math.max(1, Math.ceil(filtered.length / PER)));
  $effect(() => { void q; void fManager; void fKind; page = 0; });

  const managers = $derived([...new Set(all.map((x) => x.manager).filter(Boolean))].sort());
  const kinds = $derived([...new Set(all.map((x) => x.kind).filter((k) => k && k !== '—'))]);
  const cities = $derived(rollup(all, 'city'));
  const tot = $derived(all.reduce((a, x) => ({ revenue: a.revenue + (x.revenue ?? 0), profit: a.profit + (x.profit ?? 0) }), { revenue: 0, profit: 0 }));
  const th = (by: string) => () => (sort = { by, dir: sort.by === by ? (sort.dir === 1 ? -1 : 1) : -1 });
</script>

{#if !ds}<Empty />
{:else if !R?.has('location')}<Empty role="location / magazyn / sklep" />
{:else}
  <PageHeader title={t('loc.title')} sub={t('loc.sub')}>
    <a class="pill" href={href('/locations/region')} data-group="locations"><Icon name="layers" size={15} />{t('nav.locations.region')}</a>
    <a class="pill" href={href('/map')} data-group="locations"><Icon name="map" size={15} />{t('nav.map')}</a>
  </PageHeader>

  <div class="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
    <Kpi i={0} label={t('kpi.locations')} value={all.length || null} format="int" compact={false} icon="store" group="locations" loading={s.loading} hint="{int(all.filter((x) => x.geo === 'ok' || x.geo === 'approx').length)} {tr('na mapie', 'on the map')}" />
    <Kpi i={1} label={t('kpi.cities')} value={cities.filter((c) => c.city !== '—').length || null} format="int" compact={false} icon="pin" group="locations" loading={s.loading} />
    <Kpi i={2} label={t('kpi.revenue')} value={tot.revenue || null} format="pln" icon="coins" group="finance" loading={s.loading} hint="{tr('śr. na punkt', 'avg per point')}: {pln(all.length ? tot.revenue / all.length : 0, true)}" />
    {#if R.has('profit')}<Kpi i={3} label={t('kpi.margin')} value={tot.revenue ? tot.profit / tot.revenue : null} format="pct" icon="percent" group="products" loading={s.loading} />{/if}
  </div>

  <div class="mt-4 grid gap-4 xl:grid-cols-2">
    <Panel title={t('loc.byCity')} sub={tr('Top 8 miast', 'Top 8 cities')} icon="pin" group="locations" i={1}>
      <Chart height={340} rows={[...cities.slice(0, 8), ...(cities.length > 8 ? [{ city: tr('Pozostałe', 'Other'), revenue: cities.slice(8).reduce((a, c) => a + c.revenue, 0) }] : [])]} spec={{ chart: 'pie', name: 'city', value: 'revenue', format: 'pln', group: 'locations' }} />
    </Panel>
    <Panel title={t('loc.top')} sub={tr('Top 10 wg przychodu', 'Top 10 by revenue')} icon="trendUp" group="locations" i={2}>
      <Chart height={340} rows={all.slice(0, 10)} spec={{ chart: 'bar', x: 'loc', y: ['revenue'], horizontal: true, format: 'pln', group: 'locations' }} onclick={(p) => go(`/locations/${encodeURIComponent(p.name)}`)} />
    </Panel>
  </div>

  <Panel class="mt-4" title={tr('Wszystkie punkty', 'All points')} sub="{tr('Kliknij punkt, aby zobaczyć szczegóły', 'Click a point to see details')} · {filtered.length}" icon="store" group="locations" i={3}>
    {#snippet actions()}<button class="pill pill-sm" onclick={() => csvDownload('punkty', filtered)}><Icon name="download" size={13} />{t('common.export')}</button>{/snippet}
    <div class="mb-4 flex flex-wrap gap-2">
      <div class="relative min-w-[220px] flex-1">
        <span class="absolute top-1/2 left-3.5 -translate-y-1/2 faint"><Icon name="search" size={15} /></span>
        <input class="input !pl-10" placeholder={t('common.search')} bind:value={q} />
      </div>
      {#if managers.length}
        <select class="input !w-auto min-w-[200px]" bind:value={fManager}><option value="">{t('loc.manager')}: {t('common.all')}</option>{#each managers as m}<option>{m}</option>{/each}</select>
      {/if}
      {#if kinds.length}
        <select class="input !w-auto" bind:value={fKind}><option value="">{tr('Rodzaj', 'Type')}: {t('common.all')}</option>{#each kinds as k}<option>{k}</option>{/each}</select>
      {/if}
    </div>
    <div class="overflow-x-auto">
      <table class="table">
        <thead><tr>
          <th><button onclick={th('loc')}>{t('loc.code')}</button></th><th><button onclick={th('city')}>{t('loc.city')}</button></th>
          <th>{t('loc.manager')}</th>
          <th class="r"><button onclick={th('revenue')}>{t('kpi.revenue')}</button></th>
          {#if R.has('profit')}<th class="r"><button onclick={th('margin')}>{t('kpi.margin')}</button></th>{/if}
          {#if R.has('qty')}<th class="r"><button onclick={th('qty')}>{t('kpi.qty')}</button></th>{/if}
          <th class="r"><button onclick={th('products')}>{t('kpi.products')}</button></th><th></th>
        </tr></thead>
        <tbody>
          {#each filtered.slice(page * PER, page * PER + PER) as x, i (x.loc)}
            <tr class="clickable rise" style="--i:{i}" onclick={() => go(`/locations/${encodeURIComponent(x.loc)}`)}>
              <td><div class="font-bold">{x.loc}</div>{#if x.name}<div class="text-[11.5px] faint">{x.name}</div>{/if}</td>
              <td><div>{x.city}</div>{#if x.kind !== '—'}<div class="text-[11.5px] faint">{x.kind}</div>{/if}</td>
              <td class="muted">{x.manager ?? '—'}</td>
              <td class="r num font-semibold">{pln(x.revenue)}</td>
              {#if R.has('profit')}<td class="r"><span data-group={x.margin < 0.3 ? 'alerts' : x.margin > 0.45 ? 'finance' : 'products'}><span class="badge num">{pct(x.margin)}</span></span></td>{/if}
              {#if R.has('qty')}<td class="r num">{int(x.qty)}</td>{/if}
              <td class="r num">{int(x.products)}</td>
              <td class="r faint"><Icon name="right" size={15} /></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="mt-4 flex items-center justify-between text-[13px]">
      <span class="faint">{tr('Strona', 'Page')} {page + 1} / {pages}</span>
      <div class="flex gap-2">
        <button class="icon-btn" disabled={page === 0} onclick={() => page--} aria-label="prev"><Icon name="left" size={16} /></button>
        <button class="icon-btn" disabled={page >= pages - 1} onclick={() => page++} aria-label="next"><Icon name="right" size={16} /></button>
      </div>
    </div>
  </Panel>
{/if}
