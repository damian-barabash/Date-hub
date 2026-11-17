<script lang="ts">
  import { active, app } from '../lib/stores/app.svelte';
  import { agg, csvDownload, rolesOf, stdMetrics, type Row } from '../lib/data/api';
  import { load } from '../lib/data/load.svelte';
  import { toPoints } from '../lib/data/geo';
  import { t, tr } from '../lib/i18n.svelte';
  import { go, href, route } from '../lib/router.svelte';
  import { int, pct, pln } from '../lib/format';
  import PageHeader from '../lib/ui/PageHeader.svelte';
  import Kpi from '../lib/ui/Kpi.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Empty from '../lib/ui/Empty.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Chart from '../lib/charts/Chart.svelte';
  import MapView from '../lib/map/MapView.svelte';

  const ds = $derived(active());
  const R = $derived(ds ? rolesOf(ds) : null);
  const person = $derived(route.parts[1] ? decodeURIComponent(route.parts[1]) : null);
  let sort = $state<{ by: string; dir: 1 | -1 }>({ by: 'revenue', dir: -1 });

  const s = load(async (d) => {
    const { r } = rolesOf(d);
    if (!r.manager) return null;
    const extra = r.location ? [{ fn: 'count_distinct', col: r.location, as: 'locations' }] : [];
    const list = await agg(d, { group: [r.manager], metrics: stdMetrics(d, extra), order: [{ by: rolesOf(d).revenue ? 'revenue' : 'records', dir: 'desc' }], limit: 1000 });
    return list.map((x): Row => ({ ...x, name: x[r.manager!], per_loc: x.locations ? (x.revenue ?? 0) / x.locations : null }));
  });

  // детали выбранного кierownika
  const det = load(async (d) => {
    const { r, revenue } = rolesOf(d);
    const who = person;
    if (!who || !r.manager) return null;
    const f = [{ col: r.manager, op: 'eq', val: who }];
    const [locs, cats, prods] = await Promise.all([
      r.location ? agg(d, { group: [r.location], metrics: stdMetrics(d), filters: f, order: [{ by: revenue ? 'revenue' : 'records', dir: 'desc' }], limit: 500 }) : [],
      r.category ? agg(d, { group: [r.category], metrics: stdMetrics(d), filters: f, order: [{ by: revenue ? 'revenue' : 'records', dir: 'desc' }], limit: 12 }) : [],
      r.product ? agg(d, { group: [r.product], metrics: stdMetrics(d), filters: f, order: [{ by: revenue ? 'revenue' : 'records', dir: 'desc' }], limit: 10 }) : [],
    ]);
    return { locs: (locs as Row[]).map((x) => ({ ...x, loc: x[r.location!], manager: who })), cats, prods };
  });

  const list = $derived(((s.data ?? []) as Row[]).slice().sort((a, b) => ((a[sort.by] ?? 0) > (b[sort.by] ?? 0) ? 1 : -1) * sort.dir));
  const me = $derived(person ? (s.data ?? []).find((x: Row) => x.name === person) : null);
  const top = $derived((s.data ?? [])[0]);
  const avg = (k: string) => { const a = (s.data ?? []) as Row[]; return a.length ? a.reduce((x, y) => x + (y[k] ?? 0), 0) / a.length : null; };
  const th = (by: string) => () => (sort = { by, dir: sort.by === by ? (sort.dir === 1 ? -1 : 1) : -1 });
</script>

{#if !ds}<Empty />
{:else if !R?.has('manager')}<Empty role="manager / kierownik" />
{:else if person}
  <!-- карточка кierownika -->
  <PageHeader title={person} sub={tr('Profil kierownika', 'Manager profile')}>
    <a class="pill" href={href('/managers')}><Icon name="left" size={14} />{t('common.back')}</a>
    <button class="pill pill-accent" data-group="managers" onclick={() => go(`/chat?q=${encodeURIComponent(tr(`Przygotuj raport o kierowniku ${person}: wyniki, punkty, kategorie, ryzyka`, `Prepare a report on manager ${person}: results, points, categories, risks`))}`)}><Icon name="ask" size={15} />{tr('Raport AI', 'AI report')}</button>
  </PageHeader>
  <div class="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-5">
    <Kpi i={0} label={t('kpi.revenue')} value={me?.revenue ?? null} format="pln" icon="coins" group="finance" loading={!me} />
    {#if me?.profit !== undefined}<Kpi i={1} label={t('kpi.profit')} value={me?.profit ?? null} format="pln" icon="trendUp" group="finance" />{/if}
    {#if me?.margin !== undefined}<Kpi i={2} label={t('kpi.margin')} value={me?.margin ?? null} format="pct" icon="percent" group="products" hint="{tr('średnia sieci', 'network avg')}: {pct(avg('margin'))}" />{/if}
    {#if me?.locations !== undefined}<Kpi i={3} label={t('mg.locations')} value={me?.locations ?? null} format="int" compact={false} icon="store" group="locations" />{/if}
    {#if me?.per_loc}<Kpi i={4} label={t('mg.perLocation')} value={me?.per_loc ?? null} format="pln" icon="bolt" group="managers" hint="{tr('średnia', 'avg')}: {pln(avg('per_loc'), true)}" />{/if}
  </div>
  <div class="mt-4 grid gap-4 xl:grid-cols-3">
    <Panel class="xl:col-span-2" title={tr('Punkty kierownika', 'Manager points')} sub={tr('Przychód i marża', 'Revenue and margin')} icon="store" group="locations" i={1}>
      <Chart height={Math.max(260, (det.data?.locs.length ?? 5) * 34)} rows={det.data?.locs ?? []} spec={{ chart: 'bar', x: 'loc', y: R.has('profit') ? ['revenue', 'profit'] : ['revenue'], horizontal: true, format: 'pln', group: 'locations', labels: { revenue: t('kpi.revenue'), profit: t('kpi.profit') } }}
        onclick={(p) => go(`/locations/${encodeURIComponent(p.name)}`)} />
    </Panel>
    <Panel title={t('ov.categories')} sub={t('ov.categories.sub')} icon="layers" group="products" i={2}>
      <Chart height={340} rows={det.data?.cats ?? []} spec={{ chart: 'donut', name: R.r.category, value: 'revenue', format: 'pln', group: 'products' }} />
    </Panel>
  </div>
  <div class="mt-4 grid gap-4 xl:grid-cols-2">
    <Panel title={t('nav.map')} icon="map" group="locations" i={3}>
      <MapView points={toPoints(det.data?.locs ?? [], app.locations)} height={380} detailHref={(c) => href(`/locations/${encodeURIComponent(c)}`)} />
    </Panel>
    <Panel title={t('pr.top')} icon="box" group="products" i={4}>
      <Chart height={380} rows={det.data?.prods ?? []} spec={{ chart: 'bar', x: R.r.product, y: ['revenue'], horizontal: true, format: 'pln', group: 'products' }} />
    </Panel>
  </div>
{:else}
  <PageHeader title={t('mg.title')} sub={t('mg.sub')}>
    <a class="pill" href={href('/managers/compare')} data-group="managers"><Icon name="users" size={15} />{t('nav.managers.compare')}</a>
  </PageHeader>
  <div class="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
    <Kpi i={0} label={t('kpi.managers')} value={(s.data ?? []).length || null} format="int" compact={false} icon="users" group="managers" loading={s.loading} />
    <Kpi i={1} label={t('mg.top')} value={top?.revenue ?? null} format="pln" icon="trendUp" group="finance" hint={top?.name ?? ''} loading={s.loading} />
    <Kpi i={2} label={tr('Średni przychód', 'Average revenue')} value={avg('revenue')} format="pln" icon="coins" group="finance" loading={s.loading} />
    {#if R.has('location')}<Kpi i={3} label={tr('Śr. punktów / kierownik', 'Avg points / manager')} value={avg('locations')} format="num" icon="store" group="locations" loading={s.loading} />{/if}
  </div>

  <div class="mt-4 grid gap-4 xl:grid-cols-5">
    <Panel class="xl:col-span-3" title={tr('Porównanie przychodów', 'Revenue comparison')} sub={R.has('gross') ? tr('Netto vs brutto', 'Net vs gross') : ''} icon="report" group="managers" i={1}>
      <Chart height={Math.max(360, (s.data?.length ?? 10) * 30)} rows={s.data ?? []}
        spec={{ chart: 'bar', x: 'name', y: R.has('gross') && R.has('net') ? ['gross', 'revenue'] : ['revenue'], horizontal: true, format: 'pln', group: 'finance', labels: { gross: t('kpi.gross'), revenue: t('kpi.revenue') } }}
        onclick={(p) => go(`/managers/${encodeURIComponent(p.name)}`)} />
    </Panel>
    <Panel class="xl:col-span-2" title={t('mg.revenueVsMargin')} sub={t('mg.revenueVsMargin.sub')} icon="trendUp" group="managers" i={2}>
      {#if (s.data ?? [])[0]?.margin !== undefined}
        <Chart height={Math.max(360, (s.data?.length ?? 10) * 30)} rows={s.data ?? []} spec={{ chart: 'bubble', x: 'revenue', y: ['margin'], size: R.has('location') ? 'locations' : undefined, name: 'name', format: 'pln', group: 'managers', labels: { revenue: t('kpi.revenue'), margin: t('kpi.margin') } }} />
      {/if}
    </Panel>
  </div>

  <Panel class="mt-4" title={t('nav.managers.all')} icon="users" group="managers" i={3}>
    {#snippet actions()}<button class="pill pill-sm" onclick={() => csvDownload('kierownicy', list)}><Icon name="download" size={13} />{t('common.export')}</button>{/snippet}
    <div class="overflow-x-auto">
      <table class="table">
        <thead><tr>
          <th>#</th><th><button onclick={th('name')}>{t('loc.manager')}</button></th>
          <th class="r"><button onclick={th('revenue')}>{t('kpi.revenue')}</button></th>
          {#if R.has('profit')}<th class="r"><button onclick={th('profit')}>{t('kpi.profit')}</button></th>{/if}
          <th class="r"><button onclick={th('margin')}>{t('kpi.margin')}</button></th>
          {#if R.has('qty')}<th class="r"><button onclick={th('qty')}>{t('kpi.qty')}</button></th>{/if}
          {#if R.has('location')}<th class="r"><button onclick={th('locations')}>{t('mg.locations')}</button></th><th class="r"><button onclick={th('per_loc')}>{t('mg.perLocation')}</button></th>{/if}
        </tr></thead>
        <tbody>
          {#each list as m, i (m.name)}
            <tr class="clickable rise" style="--i:{Math.min(i, 20)}" onclick={() => go(`/managers/${encodeURIComponent(m.name)}`)}>
              <td class="faint num">{i + 1}</td>
              <td class="font-bold">{m.name}</td>
              <td class="r num">{pln(m.revenue)}</td>
              {#if R.has('profit')}<td class="r num">{pln(m.profit)}</td>{/if}
              <td class="r num"><span data-group={m.margin < 0.3 ? 'alerts' : m.margin > 0.45 ? 'finance' : 'products'}><span class="badge">{pct(m.margin)}</span></span></td>
              {#if R.has('qty')}<td class="r num">{int(m.qty)}</td>{/if}
              {#if R.has('location')}<td class="r num">{int(m.locations)}</td><td class="r num">{pln(m.per_loc, true)}</td>{/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </Panel>
{/if}
