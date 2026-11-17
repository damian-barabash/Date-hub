<script lang="ts">
  import { active } from '../lib/stores/app.svelte';
  import { agg, hist, rolesOf, stdMetrics, type Row } from '../lib/data/api';
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

  const s = load(async (d) => {
    const { r, revenue } = rolesOf(d);
    if (!r.margin || !revenue) return null;
    const ord = [{ by: 'margin', dir: 'asc' as const }];
    const [[tot], [neg], buckets, cats, mgr, heat, worst] = await Promise.all([
      agg(d, { metrics: stdMetrics(d, [{ fn: 'count_lt', col: r.margin, val: 0, as: 'neg' }, { fn: 'count_lt', col: r.margin, val: 0.1, as: 'low' }]) }),
      r.profit ? agg(d, { metrics: [{ fn: 'sum', col: r.profit, as: 'loss' }, { fn: 'count', as: 'n' }], filters: [{ col: r.profit, op: 'lt', val: 0 }] }) : Promise.resolve([{}] as Row[]),
      hist(d, r.margin, [-1e9, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0001]),
      r.category ? agg(d, { group: [r.category], metrics: stdMetrics(d), order: ord, limit: 30 }) : Promise.resolve([] as Row[]),
      r.manager ? agg(d, { group: [r.manager], metrics: stdMetrics(d), order: ord, limit: 30 }) : Promise.resolve([] as Row[]),
      r.manager && r.category ? agg(d, { group: [r.manager, r.category], metrics: stdMetrics(d), limit: 1000 }) : Promise.resolve([] as Row[]),
      r.product ? agg(d, { group: [r.product], metrics: stdMetrics(d), filters: [{ col: r.margin, op: 'lt', val: 0 }], order: [{ by: r.profit ? 'profit' : 'revenue', dir: 'asc' }], limit: 15 }) : Promise.resolve([] as Row[]),
    ]);
    // heatmap: топ-10 категорий
    const topCats = new Set([...cats].sort((a, b) => b.revenue - a.revenue).slice(0, 10).map((c) => c[r.category!]));
    // мелкие категории (< 0,2 % выручки) с экстремальной маржой ломают масштаб
    const minRev = (tot.revenue ?? 0) * 0.002;
    return { tot, neg, buckets, cats: cats.filter((c) => c.revenue > minRev), mgr, heat: heat.filter((h) => topCats.has(h[r.category!]) && h.revenue > 0), worst };
  });
  const b = $derived((s.data?.buckets ?? []).map((x: any) => ({ bucket: x.lo === null || x.lo < -1e8 ? '< 0%' : x.hi === null || x.hi > 1 ? `${Math.round(x.lo * 100)}%+` : `${Math.round(x.lo * 100)}–${Math.round(x.hi * 100)}%`, n: x.n })));
</script>

{#if !ds}<Empty />
{:else if !R?.has('margin') || !R?.revenue}<Empty role="margin / marża" />
{:else}
  <PageHeader title={t('fin.margin.title')} sub={t('fin.margin.sub')}>
    <button class="pill pill-accent" data-group="alerts" onclick={() => go(`/chat?q=${encodeURIComponent(tr('Gdzie tracimy marżę? Wskaż produkty, punkty i kierowników z najniższą marżą i zaproponuj działania', 'Where are we losing margin? Point out the products, points and managers with the lowest margin and suggest actions'))}`)}><Icon name="ask" size={15} />{tr('Gdzie tracimy?', 'Where do we lose?')}</button>
  </PageHeader>
  <div class="kpis">
    <Kpi i={0} label={t('kpi.margin')} value={s.data?.tot?.margin ?? null} format="pct" icon="percent" group="finance" loading={s.loading} hint={tr('ważona przychodem', 'revenue-weighted')} />
    <Kpi i={1} label={t('ov.negMargin')} value={s.data?.tot?.neg ?? null} format="int" compact={false} icon="trendDown" group="alerts" loading={s.loading} hint={tr('pozycji', 'line items')} />
    <Kpi i={2} label={t('ov.lowMargin')} value={s.data?.tot?.low ?? null} format="int" compact={false} icon="alert" group="products" loading={s.loading} hint={tr('pozycji', 'line items')} />
    {#if s.data?.neg?.loss !== undefined}<Kpi i={3} label={tr('Strata na ujemnych', 'Loss on negatives')} value={s.data?.neg?.loss ?? null} format="pln" icon="wallet" group="alerts" loading={s.loading} />{/if}
  </div>

  <div class="mt-4 grid gap-4 xl:grid-cols-2">
    <Panel title={t('ov.marginDist')} sub={tr('Liczba pozycji w przedziałach marży', 'Line items per margin bucket')} icon="report" group="products" i={1}>
      <Chart height={360} rows={b} spec={{ chart: 'bar', x: 'bucket', y: ['n'], format: 'int', group: 'products' }} />
    </Panel>
    {#if (s.data?.cats ?? []).length}
      <Panel title={tr('Marża wg kategorii', 'Margin by category')} icon="layers" group="products" i={2}>
        <Chart height={360} rows={s.data?.cats ?? []} spec={{ chart: 'bar', x: R.r.category, y: ['margin'], horizontal: true, format: 'pct', group: 'finance' }} />
      </Panel>
    {/if}
  </div>

  {#if (s.data?.heat ?? []).length}
    <Panel class="mt-4" title={tr('Mapa cieplna marży: kierownik × kategoria', 'Margin heatmap: manager × category')} icon="grid" group="managers" i={3}>
      <Chart height={Math.max(420, (s.data?.mgr.length ?? 10) * 28 + 80)} rows={s.data?.heat ?? []} spec={{ chart: 'heatmap', x: R.r.category, y: [R.r.manager!], value: 'margin', format: 'pct', group: 'finance' }} />
    </Panel>
  {/if}

  <div class="mt-4 grid gap-4 xl:grid-cols-2">
    {#if (s.data?.mgr ?? []).length}
      <Panel title={tr('Marża wg kierownika', 'Margin by manager')} icon="users" group="managers" i={4}>
        <Chart height={420} rows={s.data?.mgr ?? []} spec={{ chart: 'bar', x: R.r.manager, y: ['margin'], horizontal: true, format: 'pct', group: 'managers' }} />
      </Panel>
    {/if}
    {#if (s.data?.worst ?? []).length}
      <Panel title={tr('Produkty z ujemną marżą', 'Products with negative margin')} sub={tr('Największa strata', 'Largest loss')} icon="trendDown" group="alerts" i={5}>
        <div class="max-h-[420px] space-y-2 overflow-y-auto">
          {#each s.data?.worst ?? [] as p, i}
            <div class="flex items-center gap-3 rounded-xl bg-white/[0.025] px-4 py-2.5 rise" style="--i:{i}">
              <span class="min-w-0 flex-1 truncate text-[13px] font-semibold">{p[R.r.product!]}</span>
              <span class="text-[12px] faint num">{int(p.records)} {tr('poz.', 'items')}</span>
              {#if p.profit !== undefined}<span class="w-24 text-right text-[12.5px] font-bold text-[#ff8f8f] num">{pln(p.profit, true)}</span>{/if}
              <span class="badge num">{pct(p.margin)}</span>
            </div>
          {/each}
        </div>
      </Panel>
    {/if}
  </div>
{/if}
