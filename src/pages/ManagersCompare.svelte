<script lang="ts">
  import { active } from '../lib/stores/app.svelte';
  import { agg, rolesOf, stdMetrics, type Row } from '../lib/data/api';
  import { load } from '../lib/data/load.svelte';
  import { t, tr } from '../lib/i18n.svelte';
  import { go, href } from '../lib/router.svelte';
  import { pct, pln, int } from '../lib/format';
  import { palette } from '../lib/charts/theme';
  import PageHeader from '../lib/ui/PageHeader.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Empty from '../lib/ui/Empty.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Chart from '../lib/charts/Chart.svelte';

  const ds = $derived(active());
  const R = $derived(ds ? rolesOf(ds) : null);
  let picked = $state<string[]>([]);
  const pal = palette('managers');

  const s = load(async (d) => {
    const { r, revenue } = rolesOf(d);
    if (!r.manager) return null;
    const extra = [
      ...(r.location ? [{ fn: 'count_distinct', col: r.location, as: 'locations' }] : []),
      ...(r.product_id || r.product ? [{ fn: 'count_distinct', col: (r.product_id ?? r.product)!, as: 'products' }] : []),
    ];
    const list = await agg(d, { group: [r.manager], metrics: stdMetrics(d, extra), order: [{ by: revenue ? 'revenue' : 'records', dir: 'desc' }], limit: 1000 });
    const out = list.map((x): Row => ({ ...x, name: x[r.manager!], per_loc: x.locations ? (x.revenue ?? 0) / x.locations : 0 }));
    if (!picked.length) picked = out.slice(0, 3).map((x) => x.name);
    return out;
  });

  const cats = load(async (d) => {
    const { r } = rolesOf(d);
    if (!r.manager || !r.category || !rolesOf(d).revenue) return [];
    return agg(d, { group: [r.manager, r.category], metrics: [{ fn: 'sum', col: rolesOf(d).revenue!, as: 'revenue' }], order: [{ by: 'revenue', dir: 'desc' }], limit: 2000 });
  });

  const sel = $derived(((s.data ?? []) as Row[]).filter((x) => picked.includes(x.name)));
  const metrics = $derived(['revenue', 'profit', 'margin', 'qty', 'locations', 'per_loc'].filter((k) => sel[0]?.[k] !== undefined));
  const mlabel: Record<string, () => string> = { revenue: () => t('kpi.revenue'), profit: () => t('kpi.profit'), margin: () => t('kpi.margin'), qty: () => t('kpi.qty'), locations: () => t('mg.locations'), per_loc: () => t('mg.perLocation') };
  const catRows = $derived.by(() => {
    const rows = ((cats.data ?? []) as Row[]).filter((x) => picked.includes(x[R?.r.manager ?? '']));
    // топ-8 категорий по выбранным
    const tot = new Map<string, number>();
    rows.forEach((x) => tot.set(x[R!.r.category!], (tot.get(x[R!.r.category!]) ?? 0) + x.revenue));
    const topC = [...tot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map((x) => x[0]);
    return rows.filter((x) => topC.includes(x[R!.r.category!]));
  });

  function toggle(n: string) {
    picked = picked.includes(n) ? picked.filter((x) => x !== n) : picked.length >= 5 ? [...picked.slice(1), n] : [...picked, n];
  }
  const fmtM = (k: string, v: number) => (k === 'margin' ? pct(v) : k === 'qty' || k === 'locations' ? int(v) : pln(v, true));
</script>

{#if !ds}<Empty />
{:else if !R?.has('manager')}<Empty role="manager / kierownik" />
{:else}
  <PageHeader title={t('mg.compare')} sub={t('mg.compare.sub')}>
    <button class="pill pill-accent" data-group="managers" disabled={sel.length < 2}
      onclick={() => go(`/chat?q=${encodeURIComponent(tr(`Porównaj kierowników: ${picked.join(', ')}. Wskaż mocne i słabe strony każdego.`, `Compare managers: ${picked.join(', ')}. Point out strengths and weaknesses of each.`))}`)}>
      <Icon name="ask" size={15} />{tr('Analiza AI', 'AI analysis')}
    </button>
  </PageHeader>

  <div class="card card-pad rise mb-4 flex flex-wrap gap-2" data-group="managers">
    {#each (s.data ?? []) as m (m.name)}
      {@const on = picked.includes(m.name)}
      {@const c = pal[picked.indexOf(m.name) % pal.length]}
      <button class="pill pill-sm transition-all" style={on ? `background:${c};color:#0a0a0b;border-color:transparent` : ''} onclick={() => toggle(m.name)}>
        {#if on}<Icon name="check" size={13} />{/if}{m.name}
      </button>
    {/each}
  </div>

  {#if sel.length}
    <div class="grid gap-4 xl:grid-cols-2">
      <Panel title={t('mg.radar')} sub={tr('Każda oś znormalizowana do najlepszego wyniku', 'Each axis normalised to the best result')} icon="compass" group="managers" i={1}>
        <Chart height={420} rows={sel} spec={{ chart: 'radar', name: 'name', y: metrics, group: 'managers', labels: Object.fromEntries(metrics.map((k) => [k, mlabel[k]()])) }} />
      </Panel>
      <Panel title={tr('Kluczowe metryki', 'Key metrics')} icon="report" group="managers" i={2}>
        <div class="space-y-4">
          {#each metrics as k}
            {@const max = Math.max(...sel.map((x) => x[k] ?? 0), 1e-9)}
            <div>
              <div class="mb-1.5 text-[13px] font-bold faint">{mlabel[k]()}</div>
              {#each sel as m, i (m.name)}
                <div class="mb-1.5 flex items-center gap-3">
                  <div class="w-36 truncate text-[13.5px] font-semibold">{m.name}</div>
                  <div class="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                    <div class="bar h-full rounded-full" style="width:{Math.max(0, (m[k] ?? 0) / max) * 100}%; background:{pal[picked.indexOf(m.name) % pal.length]}; animation-delay:{i * 80}ms"></div>
                  </div>
                  <div class="w-24 text-right text-[13.5px] font-bold num">{fmtM(k, m[k] ?? 0)}</div>
                </div>
              {/each}
            </div>
          {/each}
        </div>
      </Panel>
    </div>
    {#if catRows.length}
      <Panel class="mt-4" title={tr('Kategorie — porównanie', 'Categories — comparison')} sub={tr('Przychód w top 8 kategoriach', 'Revenue in top 8 categories')} icon="layers" group="products" i={3}>
        <Chart height={380} rows={catRows} spec={{ chart: 'bar', x: R.r.category, y: ['revenue'], series: R.r.manager, format: 'pln', group: 'managers' }} />
      </Panel>
    {/if}
  {/if}
{/if}

<style>
  .bar { animation: grow-x 1.1s cubic-bezier(.16,1,.3,1) both; transform-origin: left; }
  @keyframes grow-x { from { transform: scaleX(0); } }
</style>
