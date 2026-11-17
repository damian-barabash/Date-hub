<script lang="ts">
  // Эксплоратор: автоматические визуализации ЛЮБОГО набора данных (без настройки ролей).
  import { active } from '../lib/stores/app.svelte';
  import { agg, hist, rows as fetchRows, rolesOf, type Row } from '../lib/data/api';
  import { load } from '../lib/data/load.svelte';
  import { t, tr } from '../lib/i18n.svelte';
  import { go } from '../lib/router.svelte';
  import { fmt, int } from '../lib/format';
  import type { Column } from '../lib/data/infer';
  import PageHeader from '../lib/ui/PageHeader.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Empty from '../lib/ui/Empty.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Chart from '../lib/charts/Chart.svelte';

  const ds = $derived(active());
  const GROUPS = ['managers', 'locations', 'products', 'finance', 'ai'];
  const isNum = (c: Column) => c.type === 'number' || c.type === 'integer';
  let page = $state(0);

  const s = load(async (d) => {
    const { revenue } = rolesOf(d);
    const measure = revenue ?? d.columns.find(isNum)?.key;
    const dims = d.columns.filter((c) => !isNum(c) && c.type !== 'date' && c.type !== 'datetime' && Number((c.stats as any)?.distinct ?? 0) >= 2 && Number((c.stats as any)?.distinct ?? 0) <= 400).slice(0, 6);
    const nums = d.columns.filter(isNum).slice(0, 6);
    const dates = d.columns.filter((c) => c.type === 'date' || c.type === 'datetime').slice(0, 1);
    const [dimRes, numRes, dateRes] = await Promise.all([
      Promise.all(dims.map((c) => agg(d, { group: [c.key], metrics: measure ? [{ fn: 'sum', col: measure, as: 'value' }, { fn: 'count', as: 'records' }] : [{ fn: 'count', as: 'value' }], order: [{ by: 'value', dir: 'desc' }], limit: 15 }))),
      Promise.all(nums.map((c) => hist(d, c.key, undefined, 14))),
      Promise.all(dates.map((c) => agg(d, { group: [c.key], metrics: measure ? [{ fn: 'sum', col: measure, as: 'value' }] : [{ fn: 'count', as: 'value' }], order: [{ by: c.key, dir: 'asc' }], limit: 1000 }))),
    ]);
    return { measure, dims: dims.map((c, i) => ({ c, rows: dimRes[i] })), nums: nums.map((c, i) => ({ c, rows: numRes[i].map((b: any) => ({ range: `${fmt(b.lo, 'num', true)}–${fmt(b.hi, 'num', true)}`, n: b.n })) })), dates: dates.map((c, i) => ({ c, rows: dateRes[i] })) };
  });

  const preview = load(async (d) => { const p = page; return fetchRows(d, { limit: 25, offset: p * 25 }); });
  const label = (k?: string) => ds?.columns.find((c) => c.key === k)?.label ?? k ?? '';
</script>

{#if !ds}<Empty />
{:else}
  <PageHeader title={t('exp.title')} sub="{t('exp.sub')} · {ds.name}">
    <button class="pill pill-accent" data-group="ai" onclick={() => go(`/chat?q=${encodeURIComponent(tr('Opisz ten zbiór danych: co zawiera, najważniejsze wnioski i 5 pomysłów na analizy', 'Describe this dataset: what it contains, key insights and 5 analysis ideas'))}`)}><Icon name="ask" size={15} />{tr('Opisz dane (AI)', 'Describe data (AI)')}</button>
  </PageHeader>

  <!-- профиль колонок -->
  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {#each ds.columns as c, i (c.key)}
      {@const st = (c.stats ?? {}) as any}
      <div class="card card-pad rise" style="--i:{Math.min(i, 16)}" data-group={isNum(c) ? 'finance' : c.type === 'date' ? 'ai' : 'locations'}>
        <div class="flex items-center justify-between gap-2">
          <div class="truncate text-[13.5px] font-bold">{c.label}</div>
          <span class="badge shrink-0">{c.type}</span>
        </div>
        <div class="mt-1 flex gap-2 text-[11.5px] faint"><code>{c.key}</code>{#if c.role}<span>· {c.role}</span>{/if}{#if c.derived}<span>· auto</span>{/if}</div>
        <div class="mt-3 text-[12.5px] muted">
          {#if isNum(c)}
            min {fmt(st.min, 'num', true)} · max {fmt(st.max, 'num', true)} · Σ {fmt(st.sum, 'num', true)}
          {:else}
            {int(st.distinct)} {tr('unikalnych', 'distinct')}{st.nulls ? ` · ${int(st.nulls)} ${tr('pustych', 'empty')}` : ''}
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <div class="mt-4 grid gap-4 xl:grid-cols-2">
    {#each s.data?.dates ?? [] as x, i}
      <Panel class="xl:col-span-2" title="{label(s.data?.measure)} · {x.c.label}" icon="calendar" group="ai" {i}>
        <Chart height={320} rows={x.rows} spec={{ chart: 'area', x: x.c.key, y: ['value'], format: 'num', group: 'ai' }} />
      </Panel>
    {/each}
    {#each s.data?.dims ?? [] as x, i}
      <Panel title="{x.c.label}" sub="{s.data?.measure ? `${tr('suma', 'sum')}: ${label(s.data.measure)}` : tr('liczba wierszy', 'row count')} · top 15" icon="report" group={GROUPS[i % GROUPS.length]} i={i + 1}>
        <Chart height={360} rows={x.rows} spec={{ chart: i % 3 === 2 ? 'donut' : 'bar', x: x.c.key, name: x.c.key, y: ['value'], value: 'value', horizontal: true, format: 'num', group: GROUPS[i % GROUPS.length] }} />
      </Panel>
    {/each}
    {#each s.data?.nums ?? [] as x, i}
      <Panel title="{tr('Rozkład', 'Distribution')}: {x.c.label}" sub={tr('2.–98. percentyl', '2nd–98th percentile')} icon="layers" group="finance" i={i + 6}>
        <Chart height={280} rows={x.rows} spec={{ chart: 'bar', x: 'range', y: ['n'], format: 'int', group: 'finance' }} />
      </Panel>
    {/each}
  </div>

  <Panel class="mt-4" title={tr('Podgląd danych', 'Data preview')} sub="{int(preview.data?.total ?? 0)} {t('common.rows')}" icon="grid" group="ai" i={8}>
    <div class="overflow-x-auto">
      <table class="table">
        <thead><tr>{#each ds.columns as c}<th>{c.label}</th>{/each}</tr></thead>
        <tbody>
          {#each preview.data?.rows ?? [] as r}
            <tr>{#each ds.columns as c}<td class:r={isNum(c)} class="num">{isNum(c) ? fmt(r[c.key], c.type === 'integer' ? 'int' : 'num') : (r[c.key] ?? '—')}</td>{/each}</tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="mt-4 flex items-center justify-end gap-2">
      <span class="mr-2 text-[13px] faint">{page + 1} / {Math.max(1, Math.ceil((preview.data?.total ?? 0) / 25))}</span>
      <button class="icon-btn" disabled={page === 0} onclick={() => page--} aria-label="prev"><Icon name="left" size={16} /></button>
      <button class="icon-btn" disabled={(page + 1) * 25 >= (preview.data?.total ?? 0)} onclick={() => page++} aria-label="next"><Icon name="right" size={16} /></button>
    </div>
  </Panel>
{/if}
