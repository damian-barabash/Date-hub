<script lang="ts">
  import { active, app } from '../lib/stores/app.svelte';
  import { rolesOf } from '../lib/data/api';
  import { load } from '../lib/data/load.svelte';
  import { locationStats, rollup, withDirectory } from '../lib/data/locs';
  import { t, tr } from '../lib/i18n.svelte';
  import { int, pct, pln } from '../lib/format';
  import PageHeader from '../lib/ui/PageHeader.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Empty from '../lib/ui/Empty.svelte';
  import Chart from '../lib/charts/Chart.svelte';

  const ds = $derived(active());
  const R = $derived(ds ? rolesOf(ds) : null);
  const s = load(locationStats);
  const all = $derived(withDirectory(s.data ?? [], app.locations));
  let dim = $state<'region' | 'branch' | 'kind' | 'city'>('region');
  const rows = $derived(rollup(all, dim));
  const dims = [
    { k: 'region', l: () => t('loc.region') }, { k: 'branch', l: () => tr('Oddział', 'Branch') },
    { k: 'kind', l: () => tr('Rodzaj punktu', 'Point type') }, { k: 'city', l: () => t('loc.city') },
  ] as const;
  const sankey = $derived.by(() => {
    const m = new Map<string, { region: string; manager: string; revenue: number }>();
    for (const x of all) {
      if (x.region === '—' || !(x.revenue > 0)) continue;
      const k = `${x.region}|${x.manager ?? '—'}`;
      const a = m.get(k) ?? { region: x.region, manager: x.manager ?? '—', revenue: 0 };
      a.revenue += x.revenue; m.set(k, a);
    }
    return [...m.values()];
  });
</script>

{#if !ds}<Empty />
{:else if !R?.has('location')}<Empty role="location / magazyn / sklep" />
{:else}
  <PageHeader title={t('loc.byRegion')} sub={tr('Województwa, oddziały i rodzaje punktów (ze słownika lokalizacji)', 'Regions, branches and point types (from the location directory)')}>
    <div class="flex max-w-full overflow-x-auto rounded-full border border-white/10 bg-[#151517] p-1" data-group="locations">
      {#each dims as d}
        <button class="shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap transition-colors" class:bg-[var(--g)]={dim === d.k} class:text-black={dim === d.k} class:faint={dim !== d.k} onclick={() => (dim = d.k)}>{d.l()}</button>
      {/each}
    </div>
  </PageHeader>

  {#key dim}
    <div class="grid gap-4 xl:grid-cols-5">
      <Panel class="xl:col-span-3" title={tr('Przychód i zysk', 'Revenue and profit')} icon="report" group="locations" i={0}>
        <Chart height={Math.max(340, rows.length * 30)} rows={rows} spec={{ chart: 'bar', x: dim, y: R.has('profit') ? ['revenue', 'profit'] : ['revenue'], horizontal: true, format: 'pln', group: 'locations', labels: { revenue: t('kpi.revenue'), profit: t('kpi.profit') } }} />
      </Panel>
      <Panel class="xl:col-span-2" title={tr('Udział w przychodzie', 'Share of revenue')} icon="layers" group="locations" i={1}>
        <Chart height={Math.max(340, rows.length * 30)} rows={rows} spec={{ chart: 'rose', name: dim, value: 'revenue', format: 'pln', group: 'locations' }} />
      </Panel>
    </div>
    <Panel class="mt-4" title={tr('Zestawienie', 'Summary')} icon="grid" group="locations" i={2}>
      <div class="overflow-x-auto">
        <table class="table">
          <thead><tr><th>{dims.find((d) => d.k === dim)?.l()}</th><th class="r">{t('kpi.locations')}</th><th class="r">{t('kpi.revenue')}</th>{#if R.has('profit')}<th class="r">{t('kpi.profit')}</th><th class="r">{t('kpi.margin')}</th>{/if}<th class="r">{tr('Na punkt', 'Per point')}</th></tr></thead>
          <tbody>
            {#each rows as x, i (x[dim])}
              <tr class="rise" style="--i:{Math.min(i, 20)}"><td class="font-bold">{x[dim]}</td><td class="r num">{int(x.points)}</td><td class="r num">{pln(x.revenue)}</td>{#if R.has('profit')}<td class="r num">{pln(x.profit)}</td><td class="r num">{pct(x.margin)}</td>{/if}<td class="r num">{pln(x.per_point, true)}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </Panel>
  {/key}

  {#if sankey.length && R.has('manager')}
    <Panel class="mt-4" title={tr('Przepływ przychodu: województwo → kierownik', 'Revenue flow: region → manager')} icon="layers" group="managers" i={3}>
      <Chart height={560} rows={sankey} spec={{ chart: 'sankey', source: 'region', target: 'manager', value: 'revenue', format: 'pln', group: 'locations' }} />
    </Panel>
  {/if}
{/if}
