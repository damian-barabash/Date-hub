<script lang="ts">
  // Документы: обзор всего / вкладка-категория / один документ. Всё строится из того, что загружено:
  // показатели, графики сумм по месяцам и контрагентам, типы документов, поиск по тексту, список.
  import { supabase } from '../lib/supabase';
  import { docs, loadDocStats, type Doc } from '../lib/docs/store.svelte';
  import { toast } from '../lib/stores/app.svelte';
  import { csvDownload } from '../lib/data/api';
  import { i18n, t, tr } from '../lib/i18n.svelte';
  import { go, href, route } from '../lib/router.svelte';
  import { int, pln } from '../lib/format';
  import PageHeader from '../lib/ui/PageHeader.svelte';
  import Kpi from '../lib/ui/Kpi.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Chart from '../lib/charts/Chart.svelte';

  const docId = $derived(route.parts[0] === 'docs' && route.parts[1] && route.parts[1] !== 'c' ? route.parts[1] : null);
  const category = $derived(route.parts[1] === 'c' && route.parts[2] ? decodeURIComponent(route.parts[2]) : null);

  let list = $state<Doc[]>([]);
  let loading = $state(true);
  let q = $state('');
  let hits = $state<any[] | null>(null);
  let searching = $state(false);
  let fType = $state('');
  let page = $state(0);
  let sort = $state<{ by: keyof Doc; dir: 1 | -1 }>({ by: 'doc_date', dir: -1 });
  const PER = 25;

  $effect(() => {
    const c = category; void docs.stats?.total; void docs.stats?.pending;
    if (docId) return;
    let alive = true; loading = true;
    let qy = supabase.from('documents').select('*').order('doc_date', { ascending: false, nullsFirst: false }).limit(3000);
    if (c) qy = qy.eq('category', c);
    qy.then(({ data }) => { if (alive) { list = (data ?? []) as Doc[]; loading = false; } });
    return () => { alive = false; };
  });
  $effect(() => { void category; q = ''; hits = null; fType = ''; page = 0; });

  // ── один документ
  let doc = $state<Doc | null>(null);
  let text = $state('');
  $effect(() => {
    const id = docId; if (!id) { doc = null; return; }
    let alive = true; text = '';
    Promise.all([supabase.from('documents').select('*').eq('id', id).maybeSingle(), supabase.rpc('doc_text', { p_id: id, p_from: 0, p_count: 40 })])
      .then(([d, tx]) => { if (alive) { doc = (d.data ?? null) as Doc | null; text = String((tx.data as any)?.text ?? ''); } });
    return () => { alive = false; };
  });

  async function search() {
    if (!q.trim()) { hits = null; return; }
    searching = true;
    const { data } = await supabase.rpc('doc_search', { p_q: q, p_limit: 20, p_category: category });
    hits = (data ?? []) as any[]; searching = false;
  }
  async function remove(d: Doc) {
    if (!confirm(`${t('common.confirm')} «${d.title}»`)) return;
    const { error } = await supabase.from('documents').delete().eq('id', d.id);
    if (error) return toast(error.message, 'err');
    await loadDocStats(); history.length > 1 ? history.back() : go('/');
  }

  // деньги считаем только по счетам и без повторов (один счёт лежит в нескольких папках; сводки и бюджеты повторяют чужие итоги)
  const party = (t: string | null) => (t ?? '—').toUpperCase().replace(/\s*(SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ|SP\.?\s*Z\s*O\.?\s*O\.?|SPÓŁKA AKCYJNA|S\.A\.)\s*/g, ' ').replace(/\s+/g, ' ').trim() || '—';
  const money = $derived.by(() => {
    const seen = new Set<string>();
    return list.filter((d) => /^faktura/i.test(d.doc_type ?? '') && (d.gross !== null || d.net !== null)).filter((d) => {
      const k = `${(d.number ?? d.id).toLowerCase().replace(/[^a-z0-9]/g, '')}|${Math.round(Number(d.gross ?? d.net))}`;
      if (seen.has(k)) return false; seen.add(k); return true;
    });
  });
  const amt = (d: Doc) => Number(d.gross ?? d.net ?? 0);
  const types = $derived.by(() => { const m = new Map<string, number>(); for (const d of list) m.set(d.doc_type ?? '—', (m.get(d.doc_type ?? '—') ?? 0) + 1); return [...m.entries()].map(([type, n]) => ({ type, n })).sort((a, b) => b.n - a.n); });
  const byMonth = $derived.by(() => {
    const m = new Map<string, { month: string; kwota: number; dokumenty: number }>();
    for (const d of list) { if (!d.doc_date) continue; const k = d.doc_date.slice(0, 7); const a = m.get(k) ?? { month: k, kwota: 0, dokumenty: 0 }; a.dokumenty += 1; m.set(k, a); }
    for (const d of money) { if (!d.doc_date) continue; const a = m.get(d.doc_date.slice(0, 7)); if (a) a.kwota += amt(d); }
    return [...m.values()].sort((a, b) => a.month.localeCompare(b.month)).map((x) => ({ ...x, label: new Date(x.month + '-01').toLocaleDateString(i18n.lang === 'en' ? 'en-GB' : 'pl-PL', { month: 'short', year: '2-digit' }).replace('.', '') }));
  });
  const byParty = $derived.by(() => { const m = new Map<string, { kontrahent: string; kwota: number; dokumenty: number }>(); for (const d of money) { const k = party(d.counterparty); const a = m.get(k) ?? { kontrahent: k, kwota: 0, dokumenty: 0 }; a.kwota += amt(d); a.dokumenty++; m.set(k, a); } return [...m.values()].sort((a, b) => b.kwota - a.kwota).slice(0, 10); });
  const byCat = $derived((docs.stats?.cats ?? []).map((c) => ({ kategoria: c.category, dokumenty: c.n })));
  const total = $derived(money.reduce((a, d) => a + amt(d), 0));
  const adv = $derived(money.filter((d) => /zaliczk/i.test(d.doc_type ?? '')).reduce((a, d) => a + amt(d), 0));
  const filtered = $derived(list.filter((d) => !fType || (d.doc_type ?? '—') === fType).sort((a, b) => {
    const x = a[sort.by], y = b[sort.by]; if (x === y) return 0; if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1; return (x > y ? 1 : -1) * sort.dir;
  }));
  const pages = $derived(Math.max(1, Math.ceil(filtered.length / PER)));
  $effect(() => { void fType; page = 0; });
  const th = (by: keyof Doc) => () => (sort = { by, dir: sort.by === by ? (sort.dir === 1 ? -1 : 1) : -1 });
  const arrow = (by: keyof Doc) => (sort.by === by ? (sort.dir === -1 ? ' ↓' : ' ↑') : '');
  const fdate = (s: string | null) => (s ? new Date(s).toLocaleDateString(i18n.lang === 'en' ? 'en-GB' : 'pl-PL') : '—');
</script>

{#if docId}
  {#if doc}
    <PageHeader title={doc.title} sub={[doc.category, doc.doc_type, doc.path].filter(Boolean).join(' · ')}>
      <button class="pill" onclick={() => (history.length > 1 ? history.back() : go('/'))}><Icon name="left" size={14} />{t('common.back')}</button>
      {#if doc.source_url}<a class="pill" href={doc.source_url} target="_blank" rel="noopener noreferrer"><Icon name="arrowUpRight" size={14} />{tr('Oryginał', 'Original')}</a>{/if}
      <button class="pill pill-accent" onclick={() => go(`/chat?q=${encodeURIComponent(tr(`Streść dokument „${doc!.title}” i wypisz najważniejsze liczby, daty i ustalenia w tabeli`, `Summarise the document “${doc!.title}” and list key figures, dates and decisions in a table`))}`)}><Icon name="ask" size={15} />{tr('Zapytaj AI', 'Ask AI')}</button>
    </PageHeader>
    <div class="grid gap-4 xl:grid-cols-3">
      <Panel class="xl:col-span-2" title={tr('Treść', 'Content')} sub="{int(doc.chars)} {tr('znaków', 'chars')}{doc.pages ? ` · ${doc.pages} ${tr('str.', 'pp.')}` : ''}{doc.ocr ? ' · OCR' : ''}" icon="report">
        <pre class="max-h-[70vh] overflow-auto text-[14.5px] leading-relaxed whitespace-pre-wrap text-[#d4d4d8]" style="font-family: var(--font-sans)">{text || '…'}</pre>
      </Panel>
      <div class="space-y-4">
        <Panel title={tr('Najważniejsze', 'Key facts')} icon="layers">
          {#if doc.summary}<p class="mb-4 text-[15px] leading-relaxed text-[#d4d4d8]">{doc.summary}</p>{/if}
          {#each [[tr('Data', 'Date'), fdate(doc.doc_date)], [tr('Kontrahent', 'Counterparty'), doc.counterparty], [tr('Numer', 'Number'), doc.number], [tr('Netto', 'Net'), doc.net !== null ? pln(doc.net) : null], ['VAT', doc.vat !== null ? pln(doc.vat) : null], [tr('Brutto', 'Gross'), doc.gross !== null ? pln(doc.gross) : null], [tr('Waluta', 'Currency'), doc.currency]].filter((x) => x[1] && x[1] !== '—') as [k, v]}
            <div class="flex items-baseline justify-between gap-4 border-t border-white/[0.06] py-2.5 text-[14.5px]"><span class="faint">{k}</span><span class="text-right font-semibold break-words">{v}</span></div>
          {/each}
          {#if doc.meta?.topics?.length}<div class="mt-3 flex flex-wrap gap-1.5">{#each doc.meta.topics as x}<span class="badge">{x}</span>{/each}</div>{/if}
        </Panel>
        <button class="pill w-full justify-center" data-group="alerts" onclick={() => remove(doc!)}><Icon name="trash" size={14} />{tr('Usuń dokument', 'Delete document')}</button>
      </div>
    </div>
  {:else}<div class="skeleton h-64"></div>{/if}
{:else if !loading && !docs.stats?.total}
  <div class="card rise mx-auto mt-10 max-w-xl p-10 text-center">
    <div class="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-white/10 muted"><Icon name="upload" size={26} /></div>
    <h2 class="text-[22px] font-semibold tracking-[-0.02em]">{tr('Wgraj dokumenty, a aplikacja ułoży się sama', 'Upload documents and the app arranges itself')}</h2>
    <p class="mt-2 text-[15px] muted">{tr('Faktury, zamówienia, umowy, raporty, prezentacje, arkusze. Zakładki w menu, wykresy i odpowiedzi asystenta powstaną z ich treści.', 'Invoices, orders, contracts, reports, presentations, sheets. Menu tabs, charts and the assistant’s answers are built from their content.')}</p>
    <a class="pill pill-accent mt-6" href={href('/sources')}><Icon name="upload" size={15} />{t('empty.cta')}</a>
  </div>
{:else}
  <PageHeader title={category ?? tr('Dokumenty', 'Documents')} sub={category ? tr('Dokumenty w tej zakładce', 'Documents in this tab') : tr('Wszystko, co zostało wgrane — uporządkowane automatycznie', 'Everything uploaded — organised automatically')}>
    {#if docs.stats?.pending}<span class="pill"><span class="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-white/20 border-t-white"></span>{tr('AI porządkuje', 'AI organising')} · {docs.stats.pending}</span>{/if}
    <button class="pill pill-accent" onclick={() => go(`/chat?q=${encodeURIComponent(category ? tr(`Przygotuj przegląd dokumentów z kategorii „${category}”: co zawierają, kwoty, terminy, na co zwrócić uwagę`, `Prepare an overview of documents in “${category}”: contents, amounts, dates, what to watch`) : tr('Przygotuj przegląd wszystkich dokumentów: kategorie, kwoty w czasie, najważniejsze ustalenia', 'Prepare an overview of all documents: categories, amounts over time, key findings'))}`)}><Icon name="ask" size={15} />{tr('Przegląd AI', 'AI overview')}</button>
  </PageHeader>

  <div class="kpis">
    <Kpi hero i={0} label={tr('Dokumenty', 'Documents')} value={list.length || null} format="int" compact={false} icon="report" {loading} hint={list.length ? `${fdate(list.reduce((m, d) => (d.doc_date && (!m || d.doc_date < m) ? d.doc_date : m), null as string | null))} – ${fdate(list.reduce((m, d) => (d.doc_date && (!m || d.doc_date > m) ? d.doc_date : m), null as string | null))}` : ''} />
    {#if money.length}<Kpi i={1} label={tr('Suma faktur (brutto)', 'Invoices total (gross)')} value={total} format="pln" icon="coins" hint="{money.length} {tr('faktur, bez powtórzeń', 'invoices, de-duplicated')}{adv ? ` · ${tr('w tym zaliczkowe', 'incl. advance')}: ${pln(adv, true)}` : ''}" />{/if}
    <Kpi i={2} label={tr('Kontrahenci', 'Counterparties')} value={new Set(list.map((d) => d.counterparty).filter(Boolean).map((x) => party(x))).size || null} format="int" compact={false} icon="users" />
    <Kpi i={3} label={tr('Rodzaje dokumentów', 'Document types')} value={types.length || null} format="int" compact={false} icon="layers" hint={types.slice(0, 2).map((x) => x.type).join(', ')} />
  </div>

  <div class="card card-pad rise mt-4" style="--i:2">
    <form class="flex flex-wrap gap-2" onsubmit={(e) => { e.preventDefault(); void search(); }}>
      <div class="relative min-w-[220px] flex-1">
        <span class="absolute top-1/2 left-3.5 -translate-y-1/2 faint"><Icon name="search" size={16} /></span>
        <input class="input !h-12 !pl-11" placeholder={tr('Szukaj w treści dokumentów… (np. zaliczka kampania świąteczna)', 'Search inside documents… (e.g. advance payment christmas campaign)')} bind:value={q} />
      </div>
      <button class="pill !h-12" disabled={searching}>{#if searching}<span class="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-white/20 border-t-white"></span>{/if}{tr('Szukaj', 'Search')}</button>
      {#if hits}<button type="button" class="pill !h-12" onclick={() => { hits = null; q = ''; }}><Icon name="x" size={14} /></button>{/if}
    </form>
    {#if hits}
      <div class="mt-4 space-y-2">
        {#if !hits.length}<div class="py-6 text-center muted">{tr('Nic nie znaleziono — spróbuj innych słów', 'Nothing found — try other words')}</div>{/if}
        {#each hits as h, i (h.id + ':' + h.idx)}
          <a class="block rounded-2xl bg-white/[0.025] p-4 transition hover:bg-white/[0.05] rise" style="--i:{i}" href={href(`/docs/${h.id}`)}>
            <div class="flex flex-wrap items-center gap-2"><span class="text-[15px] font-semibold">{h.title}</span><span class="badge">{h.doc_type ?? 'dokument'}</span>{#if h.doc_date}<span class="text-[13px] faint">{fdate(h.doc_date)}</span>{/if}</div>
            <p class="mt-1.5 line-clamp-3 text-[14px] leading-relaxed muted">{String(h.content).replace(/\s+/g, ' ').slice(0, 420)}</p>
          </a>
        {/each}
      </div>
    {/if}
  </div>

  {#if !hits}
    <div class="mt-4 grid gap-4 xl:grid-cols-2">
      {#if byMonth.length > 1}
        <Panel title={money.length ? tr('Faktury w czasie (brutto)', 'Invoices over time (gross)') : tr('Dokumenty w czasie', 'Documents over time')} sub={tr('wg daty dokumentu', 'by document date')} icon="calendar" group="locations" i={3}>
          <Chart height={320} rows={byMonth} spec={money.length ? { chart: 'bar', x: 'label', y: ['kwota'], format: 'pln', group: 'locations', labels: { kwota: tr('Kwota', 'Amount') } } : { chart: 'bar', x: 'label', y: ['dokumenty'], format: 'int', group: 'managers', labels: { dokumenty: tr('Dokumenty', 'Documents') } }} />
        </Panel>
      {/if}
      {#if byParty.length > 1}
        <Panel title={tr('Kontrahenci wg kwot faktur', 'Counterparties by invoice amount')} sub="top 10" icon="users" group="managers" i={4}>
          <Chart height={Math.max(300, byParty.length * 38)} rows={byParty} spec={{ chart: 'bar', x: 'kontrahent', y: ['kwota'], horizontal: true, format: 'pln', group: 'managers' }} />
        </Panel>
      {/if}
      {#if !category && byCat.length > 1}
        <Panel title={tr('Zakładki', 'Tabs')} sub={tr('liczba dokumentów', 'number of documents')} icon="grid" group="locations" i={5}>
          <Chart height={Math.max(300, byCat.length * 38)} rows={byCat} spec={{ chart: 'bar', x: 'kategoria', y: ['dokumenty'], horizontal: true, format: 'int', group: 'locations' }} onclick={(p) => go(`/docs/c/${encodeURIComponent(p.name)}`)} />
        </Panel>
      {/if}
      {#if types.length > 1}
        <Panel title={tr('Rodzaje dokumentów', 'Document types')} icon="layers" group="products" i={6}>
          <Chart height={320} rows={types} spec={{ chart: 'donut', name: 'type', value: 'n', format: 'int', group: 'products' }} />
        </Panel>
      {/if}
    </div>

    <Panel class="mt-4" title={tr('Lista dokumentów', 'Document list')} sub={String(filtered.length)} icon="report" i={7}>
      {#snippet actions()}
        <select class="input !h-9 !w-auto !text-[13.5px]" bind:value={fType}><option value="">{tr('Rodzaj', 'Type')}: {t('common.all')}</option>{#each types as x}<option value={x.type}>{x.type} ({x.n})</option>{/each}</select>
        <button class="pill pill-sm" onclick={() => csvDownload('dokumenty', filtered.map((d) => ({ tytul: d.title, kategoria: d.category, rodzaj: d.doc_type, data: d.doc_date, kontrahent: d.counterparty, numer: d.number, netto: d.net, brutto: d.gross, folder: d.path })))}><Icon name="download" size={13} />CSV</button>
      {/snippet}
      <div class="overflow-x-auto">
        <table class="table">
          <thead><tr>
            <th><button class:on={sort.by === 'title'} onclick={th('title')}>{tr('Dokument', 'Document')}{arrow('title')}</button></th>
            <th><button class:on={sort.by === 'doc_type'} onclick={th('doc_type')}>{tr('Rodzaj', 'Type')}{arrow('doc_type')}</button></th>
            <th><button class:on={sort.by === 'doc_date'} onclick={th('doc_date')}>{tr('Data', 'Date')}{arrow('doc_date')}</button></th>
            <th><button class:on={sort.by === 'counterparty'} onclick={th('counterparty')}>{tr('Kontrahent', 'Counterparty')}{arrow('counterparty')}</button></th>
            <th class="r"><button class:on={sort.by === 'gross'} onclick={th('gross')}>{tr('Kwota', 'Amount')}{arrow('gross')}</button></th>
          </tr></thead>
          <tbody>
            {#each filtered.slice(page * PER, page * PER + PER) as d, i (d.id)}
              <tr class="clickable rise" style="--i:{Math.min(i, 12)}" onclick={() => go(`/docs/${d.id}`)}>
                <td class="max-w-[420px]"><div class="truncate font-semibold">{d.title}</div><div class="truncate text-[13px] faint">{d.status === 'new' ? tr('w kolejce do uporządkowania…', 'waiting to be organised…') : (d.summary ?? d.path)}</div></td>
                <td>{#if d.doc_type}<span class="badge">{d.doc_type}</span>{/if}</td>
                <td class="num muted">{fdate(d.doc_date)}</td>
                <td class="max-w-[220px] truncate muted">{d.counterparty ?? '—'}</td>
                <td class="r num font-semibold">{d.gross !== null ? pln(d.gross) : d.net !== null ? pln(d.net) : '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="mt-4 flex items-center justify-between text-[14px]">
        <span class="faint">{tr('Strona', 'Page')} {page + 1} / {pages}</span>
        <div class="flex gap-2">
          <button class="icon-btn" disabled={page === 0} onclick={() => page--} aria-label="prev"><Icon name="left" size={16} /></button>
          <button class="icon-btn" disabled={page >= pages - 1} onclick={() => page++} aria-label="next"><Icon name="right" size={16} /></button>
        </div>
      </div>
    </Panel>
  {/if}
{/if}
