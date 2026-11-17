<script lang="ts">
  import { active } from '../lib/stores/app.svelte';
  import { agg, hist, rolesOf, stdMetrics, type Row } from '../lib/data/api';
  import { load } from '../lib/data/load.svelte';
  import { t, tr } from '../lib/i18n.svelte';
  import { pct, pln } from '../lib/format';
  import PageHeader from '../lib/ui/PageHeader.svelte';
  import Kpi from '../lib/ui/Kpi.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Empty from '../lib/ui/Empty.svelte';
  import Chart from '../lib/charts/Chart.svelte';

  const ds = $derived(active());
  const R = $derived(ds ? rolesOf(ds) : null);
  const EDGES = [0, 10, 20, 30, 50, 100, 200, 500, 1e9];

  const s = load(async (d) => {
    const { r, revenue } = rolesOf(d);
    if (!r.price || !revenue) return null;
    const pcol = r.product ?? r.product_id;
    const [[tot], buckets, prods] = await Promise.all([
      agg(d, { metrics: stdMetrics(d, [{ fn: 'median', col: r.price, as: 'median' }, ...(r.gross && r.qty ? [{ fn: 'ratio', col: r.gross, w: r.qty, as: 'gross_unit' }] : [])]) }),
      hist(d, r.price, EDGES),
      pcol ? agg(d, { group: [pcol], metrics: stdMetrics(d, [{ fn: 'avg', col: r.price, as: 'price' }]), order: [{ by: 'revenue', dir: 'desc' }], limit: 250 }) : Promise.resolve([] as Row[]),
    ]);
    const total = buckets.reduce((a: number, b: any) => a + b.n, 0) || 1;
    const dist = buckets.filter((b: any) => b.lo !== null && b.hi !== null).map((b: any) => ({ range: b.hi >= 1e9 ? `${b.lo}+ zł` : `${b.lo}–${b.hi} zł`, n: b.n, share: b.n / total }));
    return { tot, dist, prods, pcol, expensive: [...prods].sort((a, b) => b.price - a.price).slice(0, 10) };
  });
  const tot = $derived(s.data?.tot ?? {});
</script>

{#if !ds}<Empty />
{:else if !R?.has('price')}<Empty role="price / cena (lub netto + ilość)" />
{:else}
  <PageHeader title={t('fin.prices.title')} sub={t('fin.prices.sub')} />
  <div class="kpis">
    <Kpi i={0} label={tr('Śr. cena netto / szt.', 'Avg net price / unit')} value={tot.qty ? tot.revenue / tot.qty : null} format="pln" compact={false} icon="coins" group="finance" loading={s.loading} hint={tr('ważona sztukami', 'unit-weighted')} />
    {#if tot.gross_unit}<Kpi i={1} label={tr('Śr. cena brutto / szt.', 'Avg gross price / unit')} value={tot.gross_unit} format="pln" compact={false} icon="wallet" group="ai" loading={s.loading} />{/if}
    <Kpi i={2} label={tr('Mediana ceny pozycji', 'Median line price')} value={tot.median ?? null} format="pln" compact={false} icon="report" group="products" loading={s.loading} />
    {#if tot.margin !== undefined}<Kpi i={3} label={t('kpi.margin')} value={tot.margin ?? null} format="pct" icon="percent" group="finance" loading={s.loading} />{/if}
  </div>

  <Panel class="mt-4" title={t('fin.priceDist')} sub={tr('Liczba pozycji sprzedaży wg przedziału ceny', 'Sales line items by price range')} icon="report" group="products" i={1}>
    <div class="space-y-3.5">
      {#each s.data?.dist ?? [] as b, i}
        <div class="rise" style="--i:{i}">
          <div class="mb-1.5 flex justify-between text-[13px]"><span class="font-bold">{b.range}</span><span class="faint num">{b.n.toLocaleString('pl-PL')} · {pct(b.share)}</span></div>
          <div class="h-2.5 overflow-hidden rounded-full bg-white/[0.05]"><div class="bar h-full rounded-full bg-[#f08556]" style="width:{Math.max(b.share * 100, 0.6)}%; animation-delay:{i * 90}ms"></div></div>
        </div>
      {/each}
    </div>
  </Panel>

  <div class="mt-4 grid gap-4 xl:grid-cols-5">
    <Panel class="xl:col-span-3" title={tr('Cena vs marża (top 250 produktów)', 'Price vs margin (top 250 products)')} sub={tr('Wielkość = przychód', 'Size = revenue')} icon="trendUp" group="products" i={2}>
      <Chart height={440} rows={s.data?.prods ?? []} spec={{ chart: 'bubble', x: 'price', y: ['margin'], size: 'revenue', name: s.data?.pcol, format: 'pln', group: 'products', labels: { price: tr('Cena netto / szt.', 'Net price / unit'), margin: t('kpi.margin') } }} />
    </Panel>
    <Panel class="xl:col-span-2" title={t('pr.expensive')} icon="coins" group="finance" i={3}>
      <div class="space-y-2">
        {#each s.data?.expensive ?? [] as p, i}
          <div class="flex items-center gap-3 rounded-xl bg-white/[0.025] px-4 py-2.5 rise" style="--i:{i}">
            <span class="w-5 text-[12px] font-bold faint">{i + 1}</span>
            <span class="min-w-0 flex-1 truncate text-[13px] font-semibold">{p[s.data?.pcol ?? '']}</span>
            <span class="text-[13px] font-semibold num">{pln(p.price)}</span>
          </div>
        {/each}
      </div>
    </Panel>
  </div>
{/if}

<style>
  .bar { animation: grow-x 1.2s cubic-bezier(.16,1,.3,1) both; transform-origin: left; }
  @keyframes grow-x { from { transform: scaleX(0); } }
</style>
