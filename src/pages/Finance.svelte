<script lang="ts">
  import { active, app } from '../lib/stores/app.svelte';
  import { agg, rolesOf, stdMetrics, type Row } from '../lib/data/api';
  import { load } from '../lib/data/load.svelte';
  import { locationStats, withDirectory } from '../lib/data/locs';
  import { t, tr } from '../lib/i18n.svelte';
  import { pln } from '../lib/format';
  import PageHeader from '../lib/ui/PageHeader.svelte';
  import Kpi from '../lib/ui/Kpi.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Empty from '../lib/ui/Empty.svelte';
  import Chart from '../lib/charts/Chart.svelte';

  const ds = $derived(active());
  const R = $derived(ds ? rolesOf(ds) : null);

  const s = load(async (d) => {
    const { r, revenue } = rolesOf(d);
    if (!revenue) return null;
    const ord = [{ by: 'revenue', dir: 'desc' as const }];
    const [[tot], mgr, cats, locs] = await Promise.all([
      agg(d, { metrics: stdMetrics(d) }),
      r.manager ? agg(d, { group: [r.manager], metrics: stdMetrics(d), order: ord, limit: 20 }) : Promise.resolve([] as Row[]),
      r.category ? agg(d, { group: [r.category], metrics: stdMetrics(d), order: [{ by: r.profit ? 'profit' : 'revenue', dir: 'desc' }], limit: 15 }) : Promise.resolve([] as Row[]),
      locationStats(d),
    ]);
    return { tot, mgr, cats, locs };
  });
  const tot = $derived(s.data?.tot ?? {});
  const waterfall = $derived.by(() => {
    if (!tot.revenue) return [];
    const out: Row[] = [];
    if (tot.gross) out.push({ step: t('kpi.gross'), v: tot.gross }, { step: t('fin.vat'), v: -(tot.gross - tot.revenue) });
    else out.push({ step: t('kpi.revenue'), v: tot.revenue });
    if (tot.profit !== undefined) out.push({ step: t('fin.cost'), v: -(tot.revenue - tot.profit) }, { step: t('kpi.profit'), v: tot.profit });
    return out;
  });
  const locs = $derived(withDirectory(s.data?.locs ?? [], app.locations));
</script>

{#if !ds}<Empty />
{:else if !R?.revenue}<Empty role="net / netto / przychód" />
{:else}
  <PageHeader title={t('fin.title')} sub={t('fin.sub')} />
  <div class="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-5">
    <Kpi i={0} label={t('kpi.revenue')} value={tot.revenue ?? null} format="pln" icon="coins" group="finance" loading={s.loading} />
    {#if tot.gross !== undefined}<Kpi i={1} label={t('kpi.gross')} value={tot.gross ?? null} format="pln" icon="wallet" group="ai" loading={s.loading} hint="{t('fin.vat')}: {pln(tot.gross - tot.revenue, true)}" />{/if}
    {#if tot.profit !== undefined}<Kpi i={2} label={t('kpi.profit')} value={tot.profit ?? null} format="pln" icon="trendUp" group="finance" loading={s.loading} hint={tr('netto × marża (nie brutto − netto)', 'net × margin (not gross − net)')} />{/if}
    {#if tot.margin !== undefined}<Kpi i={3} label={t('kpi.margin')} value={tot.margin ?? null} format="pct" icon="percent" group="products" loading={s.loading} />{/if}
    {#if tot.qty}<Kpi i={4} label={t('kpi.avgUnit')} value={tot.revenue / tot.qty} format="pln" compact={false} icon="box" group="products" loading={s.loading} hint="{tr('netto / szt.', 'net / unit')}" />{/if}
  </div>

  <div class="mt-4 grid gap-4 xl:grid-cols-5">
    <Panel class="xl:col-span-2" title={t('fin.waterfall')} sub={tr('Gdzie „znika” przychód brutto', 'Where gross revenue goes')} icon="layers" group="finance" i={1}>
      <Chart height={380} rows={waterfall} spec={{ chart: 'waterfall', x: 'step', y: ['v'], format: 'pln', group: 'finance' }} />
    </Panel>
    {#if (s.data?.mgr ?? []).length}
      <Panel class="xl:col-span-3" title={t('fin.netGross')} icon="users" group="managers" i={2}>
        <Chart height={380} rows={s.data?.mgr ?? []} spec={{ chart: 'bar', x: R.r.manager, y: tot.gross !== undefined ? ['gross', 'revenue'] : ['revenue'], format: 'pln', group: 'ai', labels: { gross: t('kpi.gross'), revenue: t('kpi.revenue') } }} />
      </Panel>
    {/if}
  </div>

  <div class="mt-4 grid gap-4 xl:grid-cols-2">
    {#if (s.data?.cats ?? []).length}
      <Panel title={t('fin.profitBy')} icon="box" group="products" i={3}>
        <Chart height={400} rows={s.data?.cats ?? []} spec={{ chart: 'bar', x: R.r.category, y: R.has('profit') ? ['profit'] : ['revenue'], horizontal: true, format: 'pln', group: 'finance' }} />
      </Panel>
    {/if}
    {#if locs.length && locs[0].margin !== undefined}
      <Panel title={tr('Przychód vs marża (punkty)', 'Revenue vs margin (points)')} sub={tr('Każda kropka to punkt sprzedaży · wielkość = sztuki', 'Each dot is a point of sale · size = units')} icon="store" group="locations" i={4}>
        <Chart height={400} rows={locs} spec={{ chart: 'bubble', x: 'revenue', y: ['margin'], size: R.has('qty') ? 'qty' : undefined, name: 'loc', format: 'pln', group: 'locations', labels: { revenue: t('kpi.revenue'), margin: t('kpi.margin') } }} />
      </Panel>
    {/if}
  </div>
{/if}
