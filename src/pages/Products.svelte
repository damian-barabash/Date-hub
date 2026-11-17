<script lang="ts">
  import { active } from '../lib/stores/app.svelte';
  import { agg, csvDownload, rolesOf, stdMetrics, type Row } from '../lib/data/api';
  import { load } from '../lib/data/load.svelte';
  import { t, tr } from '../lib/i18n.svelte';
  import { go } from '../lib/router.svelte';
  import { int, pct, pln } from '../lib/format';
  import PageHeader from '../lib/ui/PageHeader.svelte';
  import Kpi from '../lib/ui/Kpi.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Empty from '../lib/ui/Empty.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Chart from '../lib/charts/Chart.svelte';

  const ds = $derived(active());
  const R = $derived(ds ? rolesOf(ds) : null);
  let cat = $state('');

  const s = load(async (d) => {
    const { r, revenue } = rolesOf(d);
    const pcol = r.product ?? r.product_id;
    if (!pcol) return null;
    const f = cat && r.category ? [{ col: r.category, op: 'eq', val: cat }] : [];
    const ord = [{ by: revenue ? 'revenue' : 'records', dir: 'desc' as const }];
    const extra = r.location ? [{ fn: 'count_distinct', col: r.location, as: 'points' }] : [];
    const [[tot], top, cats, tree, all] = await Promise.all([
      agg(d, { metrics: stdMetrics(d, [{ fn: 'count_distinct', col: pcol, as: 'products' }, ...(r.category ? [{ fn: 'count_distinct', col: r.category, as: 'cats' }] : [])]), filters: f }),
      agg(d, { group: [pcol], metrics: stdMetrics(d, extra), filters: f, order: ord, limit: 15 }),
      r.category ? agg(d, { group: [r.category], metrics: stdMetrics(d), order: ord, limit: 40 }) : Promise.resolve([] as Row[]),
      r.category && revenue ? agg(d, { group: [r.category, pcol], metrics: [{ fn: 'sum', col: revenue, as: 'revenue' }], filters: f, order: [{ by: 'revenue', dir: 'desc' }], limit: 350 }) : Promise.resolve([] as Row[]),
      agg(d, { group: [pcol], metrics: stdMetrics(d), filters: f, order: ord, limit: 3000 }),
    ]);
    const solid = all.filter((x) => (x.revenue ?? 0) > 300 && x.margin !== undefined);
    return {
      tot, top, cats: cats.filter((c) => (c.revenue ?? 0) > (tot.revenue ?? 0) * 0.002), tree, pcol,
      best: [...solid].sort((a, b) => b.margin - a.margin).slice(0, 8),
      worst: [...solid].sort((a, b) => a.margin - b.margin).slice(0, 8),
    };
  });
  const d = $derived(s.data);
</script>

{#if !ds}<Empty />
{:else if !R?.has('product') && !R?.has('product_id')}<Empty role="product / towar" />
{:else}
  <PageHeader title={t('pr.title')} sub={t('pr.sub')}>
    {#if (d?.cats ?? []).length}
      <select class="input !w-auto min-w-[200px]" bind:value={cat} data-group="products">
        <option value="">{tr('Kategoria', 'Category')}: {t('common.all')}</option>
        {#each d?.cats ?? [] as c}<option value={c[R.r.category!]}>{c[R.r.category!]}</option>{/each}
      </select>
    {/if}
    <button class="pill pill-accent" data-group="products" onclick={() => go(`/chat?q=${encodeURIComponent(tr('Przygotuj raport produktowy: bestsellery, marże, produkty do wycofania', 'Prepare a product report: bestsellers, margins, products to delist'))}`)}><Icon name="ask" size={15} />{t('rep.products')}</button>
  </PageHeader>

  <div class="kpis">
    <Kpi i={0} label={t('kpi.products')} value={d?.tot?.products ?? null} format="int" compact={false} icon="box" group="products" loading={s.loading} hint={d?.tot?.cats ? `${d.tot.cats} ${tr('kategorii', 'categories')}` : ''} />
    <Kpi i={1} label={t('kpi.revenue')} value={d?.tot?.revenue ?? null} format="pln" icon="coins" group="finance" loading={s.loading} />
    {#if R.has('qty')}<Kpi i={2} label={t('kpi.qty')} value={d?.tot?.qty ?? null} format="int" icon="layers" group="products" loading={s.loading} />{/if}
    {#if d?.tot?.margin !== undefined}<Kpi i={3} label={t('kpi.margin')} value={d?.tot?.margin ?? null} format="pct" icon="percent" group="finance" loading={s.loading} />{/if}
  </div>

  <div class="mt-4 grid gap-4 xl:grid-cols-5">
    <Panel class="xl:col-span-3" title={t('pr.top')} sub={tr('Top 15 wg przychodu', 'Top 15 by revenue')} icon="trendUp" group="products" i={1}>
      {#snippet actions()}<button class="pill pill-sm" onclick={() => csvDownload('produkty', d?.top ?? [])}><Icon name="download" size={13} />CSV</button>{/snippet}
      <Chart height={480} rows={d?.top ?? []} spec={{ chart: 'bar', x: d?.pcol, y: R.has('profit') ? ['revenue', 'profit'] : ['revenue'], horizontal: true, format: 'pln', group: 'products', labels: { revenue: t('kpi.revenue'), profit: t('kpi.profit') } }} />
    </Panel>
    {#if (d?.cats ?? []).length}
      <Panel class="xl:col-span-2" title={tr('Kategorie: przychód vs marża', 'Categories: revenue vs margin')} sub={tr('Wielkość = sztuki', 'Size = units')} icon="layers" group="products" i={2}>
        <Chart height={480} rows={d?.cats ?? []} spec={{ chart: 'bubble', x: 'revenue', y: ['margin'], size: R.has('qty') ? 'qty' : undefined, name: R.r.category, format: 'pln', group: 'products', labels: { revenue: t('kpi.revenue'), margin: t('kpi.margin') } }} />
      </Panel>
    {/if}
  </div>

  {#if (d?.tree ?? []).length}
    <Panel class="mt-4" title={t('pr.categories')} sub={tr('Kategoria › produkt · kliknij, aby przybliżyć', 'Category › product · click to zoom')} icon="grid" group="products" i={3}>
      <Chart height={520} rows={d?.tree ?? []} spec={{ chart: 'treemap', path: [R.r.category!, d!.pcol], value: 'revenue', format: 'pln', group: 'products' }} />
    </Panel>
  {/if}

  {#if (d?.best ?? []).length}
    <div class="mt-4 grid gap-4 lg:grid-cols-2">
      {#each [{ k: 'best', title: t('pr.bestMargin'), g: 'finance', icon: 'trendUp' }, { k: 'worst', title: t('pr.worstMargin'), g: 'alerts', icon: 'trendDown' }] as box, bi}
        <Panel title={box.title} sub={tr('Produkty z przychodem > 300 zł', 'Products with revenue > 300 zł')} icon={box.icon} group={box.g} i={4 + bi}>
          <div class="space-y-2">
            {#each (box.k === 'best' ? d?.best : d?.worst) ?? [] as p, i}
              <div class="flex items-center gap-3 rounded-xl bg-white/[0.025] px-4 py-3 rise" style="--i:{i}">
                <span class="w-5 text-[13px] font-bold faint">{i + 1}</span>
                <span class="min-w-0 flex-1 truncate text-[14px] font-semibold">{p[d!.pcol]}</span>
                <span class="text-[13px] faint num">{pln(p.revenue, true)}</span>
                <span class="badge num">{pct(p.margin)}</span>
              </div>
            {/each}
          </div>
        </Panel>
      {/each}
    </div>
  {/if}
{/if}
