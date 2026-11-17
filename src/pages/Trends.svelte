<script lang="ts">
  // Тренды по периодам. Источник периодов:
  //  а) колонка-дата в активном наборе → группировка по месяцам (ds_trend);
  //  б) иначе — каждый загруженный набор с заполненным «Okres» и той же структурой = одна точка.
  // Ничего не достраивается: один период → честное сообщение, что тренда пока нет.
  import { active, app, type Dataset } from '../lib/stores/app.svelte';
  import { agg, csvDownload, rolesOf, stdMetrics, type Row } from '../lib/data/api';
  import { supabase } from '../lib/supabase';
  import { i18n, t, tr } from '../lib/i18n.svelte';
  import { go, href } from '../lib/router.svelte';
  import { int, pct, pln } from '../lib/format';
  import PageHeader from '../lib/ui/PageHeader.svelte';
  import Kpi from '../lib/ui/Kpi.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Empty from '../lib/ui/Empty.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Chart from '../lib/charts/Chart.svelte';

  const ds = $derived(active());
  let rows = $state<Row[]>([]);
  let mode = $state<'date' | 'datasets'>('datasets');
  let loading = $state(true);
  let error = $state('');

  const sameShape = (a: Dataset, b: Dataset) => JSON.stringify(a.roles) === JSON.stringify(b.roles);

  $effect(() => {
    const d = ds; const all = app.datasets;
    if (!d) { loading = false; return; }
    let alive = true; loading = true; error = '';
    (async () => {
      const dateCol = d.columns.find((c) => c.key === d.roles.date);
      if (dateCol && (dateCol.type === 'date' || dateCol.type === 'datetime')) {
        const { data, error: e } = await supabase.rpc('ds_trend', { p_id: d.id, p_unit: 'month' });
        if (e) throw e;
        return { mode: 'date' as const, rows: (data ?? []) as Row[] };
      }
      // по наборам: один период = один набор (при дублях берём самый свежий)
      const byPeriod = new Map<string, Dataset>();
      for (const x of [...all].sort((p, q) => p.created_at.localeCompare(q.created_at))) {
        if (x.status === 'ready' && x.meta?.period && sameShape(x, d)) byPeriod.set(String(x.meta.period), x);
      }
      const { r } = rolesOf(d);
      const extra = r.location ? [{ fn: 'count_distinct', col: r.location, as: 'locations' }] : [];
      const out = await Promise.all([...byPeriod.entries()].map(async ([period, x]) => ({ period, ...(await agg(x, { metrics: stdMetrics(x, extra) }))[0] })));
      return { mode: 'datasets' as const, rows: out.sort((p, q) => p.period.localeCompare(q.period)) };
    })().then((res) => { if (alive) { rows = res.rows; mode = res.mode; loading = false; } })
      .catch((e) => { if (alive) { error = e?.message ?? String(e); loading = false; } });
    return () => { alive = false; };
  });

  const monthLabel = (p: string) => {
    const m = p.match(/^(\d{4})-(\d{2})$/);
    if (!m) return p;
    const s = new Date(+m[1], +m[2] - 1, 1).toLocaleDateString(i18n.lang === 'en' ? 'en-GB' : 'pl-PL', { month: 'short', year: '2-digit' });
    return s.replace('.', '');
  };
  const series = $derived(rows.map((x, i): Row => {
    const prev = rows[i - 1];
    const d = (k: string) => (prev && prev[k] ? ((x[k] - prev[k]) / Math.abs(prev[k])) * 100 : null);
    return { ...x, label: monthLabel(x.period), d_revenue: d('revenue'), d_qty: d('qty'), d_margin: prev && prev.margin !== undefined && x.margin !== undefined ? (x.margin - prev.margin) * 100 : null };
  }));
  const last = $derived(series.at(-1));
  const has = (k: string) => series.some((x) => x[k] !== undefined && x[k] !== null);
  const enough = $derived(series.length >= 2);
  const best = $derived(series.length ? series.reduce((a, b) => ((b.revenue ?? 0) > (a.revenue ?? 0) ? b : a)) : null);
  const delta = (v: number | null, unit = '%') => (v === null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString('pl-PL', { maximumFractionDigits: 1 })}${unit}`);
</script>

{#if !ds}<Empty />
{:else}
  <PageHeader title={tr('Trendy', 'Trends')} sub={tr('Jak zmieniają się przychód, marża i sprzedaż z okresu na okres', 'How revenue, margin and sales change from period to period')}>
    <span class="pill"><Icon name="calendar" size={15} />{series.length} {tr(series.length === 1 ? 'okres' : series.length < 5 ? 'okresy' : 'okresów', series.length === 1 ? 'period' : 'periods')}</span>
    {#if enough}
      <button class="pill pill-accent" onclick={() => go(`/chat?q=${encodeURIComponent(tr('Przeanalizuj trend przychodu, marży i sprzedaży między okresami — co rośnie, co spada i dlaczego', 'Analyse the revenue, margin and sales trend across periods — what grows, what falls and why'))}`)}><Icon name="ask" size={15} />{tr('Analiza AI', 'AI analysis')}</button>
    {/if}
  </PageHeader>

  <div class="kpis">
    <Kpi hero i={0} label="{tr('Przychód netto', 'Net revenue')}{last ? ` · ${last.label}` : ''}" value={last?.revenue ?? null} format="pln" icon="coins" group="finance" {loading} delta={last?.d_revenue ?? null} hint={enough ? tr('zmiana do poprzedniego okresu', 'change vs previous period') : ''} />
    {#if has('margin')}<Kpi i={1} label={t('kpi.margin')} value={last?.margin ?? null} format="pct" icon="percent" group="products" {loading} delta={last?.d_margin ?? null} deltaUnit=" pp" />{/if}
    {#if has('qty')}<Kpi i={2} label={t('kpi.qty')} value={last?.qty ?? null} format="int" icon="box" group="products" {loading} delta={last?.d_qty ?? null} />{/if}
    {#if enough && best}<Kpi i={3} label={tr('Najlepszy okres', 'Best period')} value={best.revenue ?? null} format="pln" icon="trendUp" group="finance" hint={best.label} />{/if}
  </div>

  {#if error}<div class="mt-4 text-[14px] text-[#f59a98]" role="alert">{error}</div>{/if}

  {#if !loading && !enough}
    <div class="card card-pad rise mt-4 flex flex-wrap items-center gap-5">
      <span class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/10 muted"><Icon name="trendUp" size={22} /></span>
      <div class="min-w-0 flex-1">
        <div class="card-title">{tr('Do trendu potrzebne są co najmniej dwa okresy', 'A trend needs at least two periods')}</div>
        <p class="mt-1.5 max-w-[720px] text-[15px] leading-relaxed muted">
          {tr('W bazie jest teraz jeden okres', 'There is one period in the database now')}{last ? ` (${last.label})` : ''}.
          {tr('Wgraj eksport z kolejnego miesiąca — w polu „Okres” podaj np. 2025-12 — a wykresy zbudują się same. Zadziała też jeden plik z kolumną daty.',
              'Upload the export for another month — put e.g. 2025-12 in the “Period” field — and the charts build themselves. A single file with a date column works too.')}
        </p>
      </div>
      <a class="pill pill-accent" href={href('/sources')}><Icon name="upload" size={15} />{t('empty.cta')}</a>
    </div>
  {/if}

  {#if enough}
    <Panel class="mt-4" title={tr('Trend przychodu', 'Revenue trend')} sub={has('gross') ? tr('Brutto i netto w kolejnych okresach', 'Gross and net across periods') : ''} icon="coins" group="finance" i={1}>
      <Chart height={400} rows={series} spec={{ chart: 'line', x: 'label', y: has('gross') ? ['gross', 'revenue'] : ['revenue'], format: 'pln', group: 'locations', labels: { gross: t('kpi.gross'), revenue: t('kpi.revenue') } }} />
    </Panel>

    <div class="mt-4 grid gap-4 xl:grid-cols-2">
      {#if has('margin')}
        <Panel title={tr('Trend marży', 'Margin trend')} sub={tr('Marża ważona przychodem', 'Revenue-weighted margin')} icon="percent" group="products" i={2}>
          <Chart height={320} rows={series} spec={{ chart: 'line', x: 'label', y: ['margin'], format: 'pct', group: 'products', labels: { margin: t('kpi.margin') } }} />
        </Panel>
      {/if}
      {#if has('qty')}
        <Panel title={tr('Trend sprzedaży w sztukach', 'Units sold trend')} icon="box" group="managers" i={3}>
          <Chart height={320} rows={series} spec={{ chart: 'line', x: 'label', y: ['qty'], format: 'int', group: 'managers', labels: { qty: t('kpi.qty') } }} />
        </Panel>
      {/if}
      {#if has('profit')}
        <Panel title={tr('Zysk w okresach', 'Profit by period')} icon="trendUp" group="finance" i={4}>
          <Chart height={320} rows={series} spec={{ chart: 'bar', x: 'label', y: ['profit'], format: 'pln', group: 'locations', labels: { profit: t('kpi.profit') } }} />
        </Panel>
      {/if}
      {#if has('locations')}
        <Panel title={tr('Liczba aktywnych punktów', 'Active points')} icon="store" group="locations" i={5}>
          <Chart height={320} rows={series} spec={{ chart: 'line', x: 'label', y: ['locations'], format: 'int', group: 'locations', labels: { locations: t('kpi.locations') } }} />
        </Panel>
      {/if}
    </div>

    <Panel class="mt-4" title={tr('Zmiany okres do okresu', 'Period-over-period changes')} icon="grid" group="finance" i={6}>
      {#snippet actions()}<button class="pill pill-sm" onclick={() => csvDownload('trendy', series)}><Icon name="download" size={13} />{t('common.export')}</button>{/snippet}
      <div class="overflow-x-auto">
        <table class="table">
          <thead><tr>
            <th>{tr('Okres', 'Period')}</th><th class="r">{t('kpi.revenue')}</th><th class="r">Δ</th>
            {#if has('margin')}<th class="r">{t('kpi.margin')}</th><th class="r">Δ</th>{/if}
            {#if has('qty')}<th class="r">{t('kpi.qty')}</th><th class="r">Δ</th>{/if}
          </tr></thead>
          <tbody>
            {#each [...series].reverse() as x, i (x.period)}
              <tr class="rise" style="--i:{Math.min(i, 14)}">
                <td class="font-semibold">{x.label}</td>
                <td class="r num font-semibold">{pln(x.revenue)}</td>
                <td class="r num" style="color:{x.d_revenue === null ? '#71717a' : x.d_revenue >= 0 ? '#34d399' : '#f04438'}">{delta(x.d_revenue)}</td>
                {#if has('margin')}<td class="r num">{pct(x.margin)}</td><td class="r num" style="color:{x.d_margin === null ? '#71717a' : x.d_margin >= 0 ? '#34d399' : '#f04438'}">{delta(x.d_margin, ' pp')}</td>{/if}
                {#if has('qty')}<td class="r num">{int(x.qty)}</td><td class="r num" style="color:{x.d_qty === null ? '#71717a' : x.d_qty >= 0 ? '#34d399' : '#f04438'}">{delta(x.d_qty)}</td>{/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="mt-3 text-[13px] faint">{mode === 'date' ? tr('Okresy z kolumny daty aktywnego zbioru.', 'Periods come from the date column of the active dataset.') : tr('Każdy okres to osobny wgrany zbiór o tej samej strukturze.', 'Each period is a separately uploaded dataset with the same structure.')}</p>
    </Panel>
  {/if}
{/if}
