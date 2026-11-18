<script lang="ts">
  // Документы: обзор всего / вкладка-категория / один документ. Всё строится из того, что загружено:
  // показатели, графики сумм по месяцам и контрагентам, типы документов, поиск по тексту, список.
  import { supabase } from '../lib/supabase';
  import { docs, loadDocStats, type Doc } from '../lib/docs/store.svelte';
  import { active } from '../lib/stores/app.svelte';
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
  import Blocks from '../lib/chat/Blocks.svelte';
  import Markdown from '../lib/chat/Markdown.svelte';
  import { askAI } from '../lib/chat/sse';
  import { fin, loadFinance, saveFact, type FinRow } from '../lib/finance/store.svelte';

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
    // лёгкие поля, постранично (сервер отдаёт максимум 1000 строк за запрос)
    (async () => {
      const out: Doc[] = [];
      for (let from = 0; from < 20000; from += 1000) {
        let qy = supabase.from('documents').select('id,title,category,doc_type,summary,doc_date,counterparty,party_code,number,net,gross,meta,status').order('doc_date', { ascending: false, nullsFirst: false }).order('id').range(from, from + 999);
        if (c) qy = qy.eq('category', c);
        const { data } = await qy;
        out.push(...((data ?? []) as unknown as Doc[]));
        if ((data ?? []).length < 1000) break;
      }
      if (alive) { list = out; loading = false; }
    })();
    return () => { alive = false; };
  });
  $effect(() => { void category; q = ''; hits = null; fType = ''; page = 0; });
  // воркспейс без документов, но с таблицей продаж → сразу обзор продаж
  $effect(() => { if (!docId && !category && docs.stats && !docs.stats.total && active()) go('/sales'); });

  // ── дашборд вкладки: ИИ строит его из данных самой вкладки (не шаблон); хранится на сервере
  let dash = $state<{ content: any; doc_count: number; updated_at: string } | null>(null);
  let dashLoaded = $state(false);
  let building = $state(false);
  let buildSteps = $state<string[]>([]);
  let buildErr = $state('');
  const tried = new Set<string>();
  $effect(() => {
    const c = category; dash = null; dashLoaded = false; buildErr = '';
    if (!c) return;
    let alive = true;
    supabase.from('dashboards').select('content, doc_count, updated_at').eq('category', c).maybeSingle().then(({ data }) => {
      if (!alive) return;
      dash = (data ?? null) as typeof dash; dashLoaded = true;
      if (!data && !tried.has(c) && !building) { tried.add(c); void buildDash(c); } // новая вкладка — собираем при первом открытии
    });
    return () => { alive = false; };
  });
  async function buildDash(c: string) {
    if (building) return;
    building = true; buildErr = ''; buildSteps = [tr('Rozpoznaję, co jest w tej zakładce', 'Working out what this tab contains')];
    try {
      await askAI({ message: '', dashboard: c, lang: i18n.lang }, (e) => {
        if (e.event === 'query') buildSteps = [...buildSteps, `${tr('Liczę', 'Computing')}: ${e.data.purpose || e.data.id}`];
        else if (e.event === 'docs') buildSteps = [...buildSteps, `${e.data.kind === 'open' ? tr('Czytam', 'Reading') : tr('Szukam', 'Searching')}: ${e.data.q}`];
        else if (e.event === 'status' && e.data.step === 'visualising') buildSteps = [...buildSteps, tr('Układam wykresy', 'Arranging charts')];
        else if (e.event === 'final') { if (category === c && e.data.blocks?.length) dash = { content: e.data, doc_count: e.data.doc_count ?? 0, updated_at: new Date().toISOString() }; else if (!e.data.blocks?.length) buildErr = tr('Nie udało się zbudować dashboardu z tych danych', 'Could not build a dashboard from this data'); }
        else if (e.event === 'error') buildErr = e.data.message;
      });
    } catch (e) { buildErr = e instanceof Error ? e.message : String(e); }
    building = false;
  }
  const stale = $derived(!!dash && !!category && !loading && dash.doc_count !== list.length);

  // ── правка дашборда: добавить блок запросом к ИИ, изменить блок, удалить, переставить
  let editAt = $state<number | null>(null);   // индекс изменяемого блока; -1 = новый блок
  let editPrompt = $state('');
  let editing = $state(false);
  let editSteps = $state<string[]>([]);
  const blockDesc = (b: any) => `${b?.type === 'chart' ? `wykres ${b.chart ?? ''}` : b?.type ?? 'blok'}${b?.title ? ` „${b.title}”` : ''}`;
  async function saveBlocks(blocks: any[]) {
    if (!dash || !category) return;
    const used = new Set(blocks.map((b) => b.q).filter(Boolean));
    const results = Object.fromEntries(Object.entries(dash.content.results ?? {}).filter(([k]) => used.has(k)));
    const content = { ...dash.content, blocks, results };
    const prev = dash; dash = { ...dash, content };
    const { error } = await supabase.from('dashboards').update({ content, updated_at: new Date().toISOString() }).eq('category', category);
    if (error) { dash = prev; toast(error.message, 'err'); }
  }
  function removeBlock(i: number) {
    if (!dash || !confirm(tr(`Usunąć blok ${blockDesc(dash.content.blocks[i])}?`, `Delete block ${blockDesc(dash.content.blocks[i])}?`))) return;
    void saveBlocks(dash.content.blocks.filter((_: any, j: number) => j !== i));
  }
  function moveBlock(i: number, d: -1 | 1) {
    if (!dash) return; const b = [...dash.content.blocks]; const j = i + d; if (j < 0 || j >= b.length) return;
    [b[i], b[j]] = [b[j], b[i]]; void saveBlocks(b);
  }
  async function runEdit() {
    if (!category || !editPrompt.trim() || editing) return;
    const c = category; const idx = editAt !== null && editAt >= 0 ? editAt : null;
    editing = true; editSteps = [tr('Analizuję prośbę', 'Reading the request')];
    try {
      await askAI({ message: '', dashboard: c, lang: i18n.lang, edit: { prompt: editPrompt, index: idx, block: idx !== null ? blockDesc(dash?.content.blocks[idx]) : '' } }, (e) => {
        if (e.event === 'query') editSteps = [...editSteps, `${tr('Liczę', 'Computing')}: ${e.data.purpose || e.data.id}`];
        else if (e.event === 'docs') editSteps = [...editSteps, `${e.data.kind === 'open' ? tr('Czytam', 'Reading') : tr('Szukam', 'Searching')}: ${e.data.q}`];
        else if (e.event === 'final') {
          if (!e.data.added) { toast(e.data.note || tr('Nie udało się zbudować bloku — spróbuj inaczej sformułować prośbę', 'Could not build the block — try rephrasing'), 'err'); return; }
          if (category === c) dash = { content: { text: dash?.content.text ?? '', blocks: e.data.blocks, results: e.data.results }, doc_count: dash?.doc_count ?? 0, updated_at: new Date().toISOString() };
          editAt = null; editPrompt = ''; toast(idx !== null ? tr('Blok zmieniony', 'Block updated') : tr('Blok dodany', 'Block added'));
        } else if (e.event === 'error') toast(e.data.message, 'err');
      });
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'err'); }
    editing = false;
  }

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
    await loadDocStats(); toast(tr('Usunięto z bazy wiedzy', 'Deleted from the knowledge base')); history.length > 1 ? history.back() : go('/sources');
  }

  // деньги — только из финансового реестра (сервер склеивает копии, авансы, расчётные счета и корректировки до гроша)
  const party = (t: string | null) => (t ?? '—').toUpperCase().replace(/\s*(SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ|SP\.?\s*Z\s*O\.?\s*O\.?|SPÓŁKA AKCYJNA|S\.A\.)\s*/g, ' ').replace(/\s+/g, ' ').trim() || '—';
  $effect(() => { void docs.stats?.total; if (!docId) void loadFinance(); });
  const listIds = $derived(category ? new Set(list.map((d) => d.id)) : null);
  const money = $derived(fin.rows.filter((r) => !listIds || (r.main_doc !== null && listIds.has(r.main_doc))));
  const amt = (r: FinRow) => Number(r.value_gross ?? 0);
  const openSum = $derived(money.filter((r) => r.pay_status === 'niezapłacona' || r.pay_status === 'częściowo').reduce((a, r) => a + Number(r.open ?? 0), 0));
  const unknownSum = $derived(money.filter((r) => r.pay_status === 'brak danych').reduce((a, r) => a + amt(r), 0));
  const newestAsof = $derived(money.map((r) => r.pay_asof).filter(Boolean).sort().pop() ?? null);
  const types = $derived.by(() => { const m = new Map<string, number>(); for (const d of list) m.set(d.doc_type ?? '—', (m.get(d.doc_type ?? '—') ?? 0) + 1); return [...m.entries()].map(([type, n]) => ({ type, n })).sort((a, b) => b.n - a.n); });
  const byMonth = $derived.by(() => {
    const m = new Map<string, { month: string; kwota: number; dokumenty: number }>();
    for (const d of list) { if (!d.doc_date) continue; const k = d.doc_date.slice(0, 7); const a = m.get(k) ?? { month: k, kwota: 0, dokumenty: 0 }; a.dokumenty += 1; m.set(k, a); }
    for (const r of money) { if (!r.issue_date) continue; const k = r.issue_date.slice(0, 7); const a = m.get(k) ?? { month: k, kwota: 0, dokumenty: 0 }; a.kwota += amt(r); m.set(k, a); }
    return [...m.values()].sort((a, b) => a.month.localeCompare(b.month)).map((x) => ({ ...x, label: new Date(x.month + '-01').toLocaleDateString(i18n.lang === 'en' ? 'en-GB' : 'pl-PL', { month: 'short', year: '2-digit' }).replace('.', '') }));
  });
  const byParty = $derived.by(() => { const m = new Map<string, { kontrahent: string; kwota: number; dokumenty: number }>(); for (const r of money) { const k = r.seller_code || party(r.seller); const a = m.get(k) ?? { kontrahent: k, kwota: 0, dokumenty: 0 }; a.kwota += amt(r); a.dokumenty++; m.set(k, a); } return [...m.values()].sort((a, b) => b.kwota - a.kwota).slice(0, 10); });
  // kontrahenci: firmy scalone po NIP / nazwie (documents.party_code), nie surowe napisy z dokumentów
  const parties = $derived.by(() => {
    const m = new Map<string, number>();
    for (const d of list as (Doc & { party_code?: string | null })[]) if (d.party_code) m.set(d.party_code, (m.get(d.party_code) ?? 0) + 1);
    return [...m.entries()].map(([code, n]) => {
      const p = fin.parties.find((x) => x.code === code); const s = fin.summary?.sellers?.find((x) => x.code === code);
      return { code, n, name: p?.name ?? code, role: p?.role === 'seller' ? tr('nasza firma', 'our company') : p?.role === 'buyer' ? tr('klient', 'client') : '', invoiced: s ? Number((s as any).value_gross ?? 0) : null, open: s ? s.open : p?.role === 'buyer' ? (fin.facts.find((f) => f.key === 'receivables')?.value ?? fin.summary?.open_confirmed ?? null) : null };
    }).sort((a, b) => b.n - a.n);
  });
  const mainParties = $derived(parties.filter((p) => p.n > 1 || p.invoiced !== null));
  // należności: kwota ustalona przez firmę (jeśli jest) vs to, co potwierdzają dokumenty
  const recvFact = $derived(category ? null : (fin.facts.find((f) => f.key === 'receivables') ?? null));
  let factEdit = $state(false); let factVal = $state(''); let factNote = $state('');
  async function storeFact(clear = false) {
    const v = clear ? null : Number(factVal.replace(/\s/g, '').replace(',', '.'));
    if (!clear && !Number.isFinite(v)) return toast(tr('Podaj kwotę', 'Enter an amount'), 'err');
    try { await saveFact('receivables', v, new Date().toISOString().slice(0, 10), factNote.trim() || null); factEdit = false; toast(tr('Zapisano', 'Saved')); }
    catch (e: any) { toast(e.message, 'err'); }
  }
  const byCat = $derived((docs.stats?.cats ?? []).map((c) => ({ kategoria: c.category, dokumenty: c.n })));
  const total = $derived(money.reduce((a, d) => a + amt(d), 0));
  const recent = $derived(list.filter((d) => d.summary && d.doc_date).slice(0, 8));
  const topInv = $derived([...money].sort((a, b) => amt(b) - amt(a)).slice(0, 6));
  const topics = $derived.by(() => {
    const m = new Map<string, number>();
    for (const d of list) for (const x of d.meta?.topics ?? []) { const k = String(x).toLowerCase().trim(); if (k.length > 2 && k.length < 40) m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 18);
  });
  const kbHref = $derived(href(`/sources${category ? `?cat=${encodeURIComponent(category)}` : ''}`));
  const filtered = $derived(list.filter((d) => !fType || (d.doc_type ?? '—') === fType).sort((a, b) => {
    const x = a[sort.by], y = b[sort.by]; if (x === y) return 0; if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1; return (x > y ? 1 : -1) * sort.dir;
  }));
  const pages = $derived(Math.max(1, Math.ceil(filtered.length / PER)));
  $effect(() => { void fType; page = 0; });
  const th = (by: keyof Doc) => () => (sort = { by, dir: sort.by === by ? (sort.dir === 1 ? -1 : 1) : -1 });
  const arrow = (by: keyof Doc) => (sort.by === by ? (sort.dir === -1 ? ' ↓' : ' ↑') : '');
  const grosz = (v: number) => `${v.toLocaleString(i18n.lang === 'en' ? 'en-GB' : 'pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`; // co do grosza
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
  <PageHeader title={category ?? tr('Przegląd', 'Overview')} sub={category ? tr('Podsumowanie tej zakładki — liczby, wykresy i wyciągi z dokumentów', 'Summary of this tab — figures, charts and excerpts from documents') : tr('Podsumowanie całej bazy wiedzy — liczby, wykresy i wyciągi z dokumentów', 'Summary of the whole knowledge base — figures, charts and excerpts')}>
    <a class="pill" href={kbHref}><Icon name="database" size={15} />{tr('Baza wiedzy', 'Knowledge base')} · {int(list.length)} {tr('dok.', 'docs')}</a>
    {#if docs.stats?.pending}<span class="pill"><span class="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-white/20 border-t-white"></span>{tr('AI porządkuje', 'AI organising')} · {docs.stats.pending}</span>{/if}
    <button class="pill pill-accent" onclick={() => go(`/chat?q=${encodeURIComponent(category ? tr(`Przygotuj przegląd dokumentów z kategorii „${category}”: co zawierają, kwoty, terminy, na co zwrócić uwagę`, `Prepare an overview of documents in “${category}”: contents, amounts, dates, what to watch`) : tr('Przygotuj przegląd wszystkich dokumentów: kategorie, kwoty w czasie, najważniejsze ustalenia', 'Prepare an overview of all documents: categories, amounts over time, key findings'))}`)}><Icon name="ask" size={15} />{tr('Przegląd AI', 'AI overview')}</button>
  </PageHeader>

  <div class="kpis">
    <Kpi hero i={0} label={tr('Dokumenty', 'Documents')} value={list.length || null} format="int" compact={false} icon="report" {loading} hint={list.length ? `${fdate(list.reduce((m, d) => (d.doc_date && (!m || d.doc_date < m) ? d.doc_date : m), null as string | null))} – ${fdate(list.reduce((m, d) => (d.doc_date && (!m || d.doc_date > m) ? d.doc_date : m), null as string | null))}` : ''} />
    {#if money.length}<Kpi i={1} label={tr('Zafakturowano (brutto)', 'Invoiced (gross)')} value={total} format="pln" icon="coins" hint="{money.length} {tr('faktur, każda kwota liczona raz', 'invoices, each amount counted once')}{!category && fin.summary?.duplicates_removed ? ` · ${tr('bez dubli', 'w/o duplicates')} ${pln(fin.summary.duplicates_removed, true)}` : ''}" />
      {#if recvFact}<Kpi i={2} label={tr('Należności otwarte', 'Open receivables')} value={recvFact.value} format="pln" icon="alert" group="alerts" hint="{tr('wg firmy', 'per company')} {fdate(recvFact.asof)} · {tr('w dokumentach', 'in documents')} {pln(openSum, true)}" />
      {:else}<Kpi i={2} label={tr('Należności otwarte', 'Open receivables')} value={openSum} format="pln" icon="alert" group="alerts" hint="{newestAsof ? `${tr('dane', 'data')}: ${fdate(newestAsof)}` : ''}{unknownSum ? ` · ${tr('status nieznany', 'status unknown')} ${pln(unknownSum, true)}` : ''}" />{/if}{/if}
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

  {#if category && !hits}
    {#if building}
      <div class="card card-pad rise mt-4">
        <div class="flex items-center gap-3 text-[16px] font-semibold"><span class="spin inline-block h-4 w-4 rounded-full border-2 border-white/20 border-t-white"></span>{tr('Buduję dashboard z danych tej zakładki', 'Building the dashboard from this tab’s data')}</div>
        <div class="mt-3 space-y-1.5">{#each buildSteps.slice(-6) as st, i (i + st)}<div class="rise truncate text-[14px] muted">{st}</div>{/each}</div>
      </div>
    {:else if dash}
      {#if dash.content.text}<div class="mt-5 max-w-[980px] rise"><Markdown text={dash.content.text} /></div>{/if}
      <div class="mt-6"><Blocks blocks={dash.content.blocks ?? []} results={dash.content.results ?? {}} tools={blockTools} /></div>
      {#snippet blockTools(i: number, _b: any)}
        <button class="pill pill-sm" title={tr('Zmień z AI', 'Change with AI')} onclick={() => { editAt = i; editPrompt = ''; }}><Icon name="pen" size={13} />{tr('Zmień', 'Change')}</button>
        <button class="icon-btn !h-8 !w-8" title={tr('W górę', 'Move up')} disabled={i === 0} onclick={() => moveBlock(i, -1)}><span class="inline-block rotate-180"><Icon name="chevron" size={14} /></span></button>
        <button class="icon-btn !h-8 !w-8" title={tr('W dół', 'Move down')} disabled={i === (dash?.content.blocks.length ?? 1) - 1} onclick={() => moveBlock(i, 1)}><Icon name="chevron" size={14} /></button>
        <button class="icon-btn !h-8 !w-8" data-group="alerts" title={tr('Usuń blok', 'Delete block')} aria-label={tr('Usuń blok', 'Delete block')} onclick={() => removeBlock(i)}><Icon name="trash" size={14} /></button>
      {/snippet}
      {#if editAt !== null}
        <div class="card card-pad rise mt-4" role="dialog" aria-label={tr('Edycja bloku', 'Edit block')}>
          <div class="text-[16px] font-semibold">{editAt >= 0 ? `${tr('Zmień blok', 'Change block')} ${blockDesc(dash.content.blocks[editAt])}` : tr('Nowy blok', 'New block')}</div>
          <p class="mt-1 text-[14px] muted">{tr('Napisz, co ma pokazywać — AI policzy dane i zbuduje blok. Np. „pokaż sprzedaż za październik wg tygodni”, „zamień na tabelę z kwotami”, „tylko firma MTMC, 2026”.', 'Describe what it should show — AI computes the data and builds the block. E.g. “show October sales by week”, “turn it into a table”, “only MTMC, 2026”.')}</p>
          <form class="mt-3 flex flex-col gap-2 sm:flex-row" onsubmit={(e) => { e.preventDefault(); void runEdit(); }}>
            <!-- svelte-ignore a11y_autofocus -->
            <input class="input min-w-0 flex-1" autofocus bind:value={editPrompt} disabled={editing} placeholder={tr('Co ma pokazać ten blok?', 'What should this block show?')} />
            <button class="pill pill-accent !h-[42px] justify-center" disabled={editing || !editPrompt.trim()}>{#if editing}<span class="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white"></span>{/if}{editAt >= 0 ? tr('Zmień blok', 'Change block') : tr('Dodaj blok', 'Add block')}</button>
            <button type="button" class="pill !h-[42px] justify-center" disabled={editing} onclick={() => (editAt = null)}>{tr('Anuluj', 'Cancel')}</button>
          </form>
          {#if editing}<div class="mt-3 space-y-1">{#each editSteps.slice(-4) as st, i (i + st)}<div class="rise truncate text-[13.5px] muted">{st}</div>{/each}</div>{/if}
        </div>
      {/if}
      <div class="mt-4 flex flex-wrap items-center gap-3 text-[13.5px] faint">
        <button class="pill pill-sm pill-accent" onclick={() => { editAt = -1; editPrompt = ''; }}><Icon name="plus" size={13} />{tr('Dodaj blok', 'Add block')}</button>
        <span>{tr('Dashboard zbudowany z danych tej zakładki', 'Dashboard built from this tab’s data')} · {new Date(dash.updated_at).toLocaleDateString(i18n.lang === 'en' ? 'en-GB' : 'pl-PL')}</span>
        {#if stale}<span class="text-[#ffb020]">{tr('dokumenty się zmieniły', 'documents have changed')}</span>{/if}
        <button class="pill pill-sm" onclick={() => { if (confirm(tr('Zbudować dashboard od nowa? Twoje zmiany bloków zostaną zastąpione.', 'Rebuild from scratch? Your block changes will be replaced.'))) void buildDash(category!); }}><Icon name="refresh" size={13} />{tr('Zbuduj ponownie', 'Rebuild')}</button>
      </div>
    {:else if buildErr}
      <div class="card card-pad mt-4 flex flex-wrap items-center gap-3 text-[14.5px]" role="alert"><span class="min-w-0 flex-1 text-[#f59a98]">{buildErr}</span><button class="pill pill-sm" onclick={() => buildDash(category!)}><Icon name="refresh" size={13} />{tr('Spróbuj ponownie', 'Try again')}</button></div>
    {/if}
  {/if}
  {#if !hits && !category && (mainParties.length || money.length)}
    <div class="mt-4 grid gap-4 xl:grid-cols-2">
      {#if mainParties.length}
        <Panel title={tr('Kontrahenci', 'Counterparties')} sub={tr('warianty nazw jednej firmy scalone po NIP', 'name variants of one company merged by tax ID')} icon="users" group="managers" i={3}>
          <div class="space-y-1.5">
            {#each mainParties.slice(0, 12) as p (p.code)}
              <div class="flex items-center gap-3 rounded-xl bg-white/[0.025] px-3.5 py-2.5">
                <span class="min-w-0 flex-1"><span class="block truncate text-[14px] font-semibold">{p.name}{#if p.name !== p.code}<span class="faint font-normal"> · {p.code}</span>{/if}</span><span class="block truncate text-[13px] faint">{p.role ? `${p.role} · ` : ''}{int(p.n)} {tr('dok.', 'docs')}{p.invoiced ? ` · ${tr('faktury', 'invoiced')} ${pln(p.invoiced, true)}` : ''}</span></span>
                {#if p.open}<span class="shrink-0 text-right"><span class="block text-[14.5px] font-semibold num">{grosz(p.open)}</span><span class="block text-[12px] faint">{p.role === tr('klient', 'client') ? tr('winien nam', 'owes us') : tr('otwarte', 'open')}</span></span>{/if}
              </div>
            {/each}
          </div>
          {#if parties.length > mainParties.length}<p class="mt-3 text-[13px] faint">+ {parties.length - mainParties.length} {tr('firm z pojedynczym dokumentem', 'companies with a single document')}</p>{/if}
        </Panel>
      {/if}
      {#if money.length}
        <Panel title={tr('Należności od klienta', 'Receivables from the client')} sub={tr('kwota firmy i to, co potwierdzają dokumenty', 'company figure vs what documents confirm')} icon="alert" group="alerts" i={4}>
          {#snippet actions()}<button class="pill pill-sm" onclick={() => { factEdit = !factEdit; factVal = recvFact ? String(recvFact.value) : ''; factNote = recvFact?.note ?? ''; }}><Icon name="pen" size={13} />{recvFact ? tr('Zmień', 'Change') : tr('Podaj kwotę firmy', 'Enter company figure')}</button>{/snippet}
          {#if factEdit}
            <form class="mb-4 flex flex-col gap-2" onsubmit={(e) => { e.preventDefault(); void storeFact(); }}>
              <input class="input" inputmode="decimal" bind:value={factVal} placeholder={tr('Ile klient jest winien łącznie, np. 2924000', 'Total the client owes, e.g. 2924000')} />
              <input class="input" bind:value={factNote} placeholder={tr('Skąd ta kwota (opcjonalnie)', 'Where it comes from (optional)')} />
              <div class="flex flex-wrap gap-2"><button class="pill pill-accent pill-sm">{tr('Zapisz', 'Save')}</button>{#if recvFact}<button type="button" class="pill pill-sm" data-group="alerts" onclick={() => storeFact(true)}>{tr('Usuń kwotę firmy', 'Remove company figure')}</button>{/if}<button type="button" class="pill pill-sm" onclick={() => (factEdit = false)}>{tr('Anuluj', 'Cancel')}</button></div>
            </form>
          {/if}
          {@const rows = [
            ...(recvFact ? [[tr('Wg firmy', 'Per company') + ` (${fdate(recvFact.asof)})`, recvFact.value, recvFact.note ?? '']] : []),
            [tr('Potwierdzone w dokumentach', 'Confirmed in documents'), openSum, newestAsof ? `${tr('najnowsze dane', 'newest data')}: ${fdate(newestAsof)}` : ''],
            [tr('Faktury bez statusu płatności', 'Invoices without payment status'), unknownSum, tr('nie ma ich na najnowszej liście należności, brak potwierdzenia zapłaty', 'not on the newest receivables list, no payment confirmation')],
            ...(recvFact ? [[tr('Brakuje w dokumentach', 'Missing in documents'), recvFact.value - openSum, recvFact.value - openSum > 0 ? tr('faktury/zestawienia, których nie wgrano, albo część faktur bez statusu', 'invoices/registries not uploaded, or part of the invoices without status') : tr('dokumenty pokazują więcej niż kwota firmy', 'documents show more than the company figure')]] : []),
          ] as [string, number, string][]}
          <div class="space-y-1.5">
            {#each rows as [k, v, h], i (i)}
              <div class="flex items-center gap-3 rounded-xl bg-white/[0.025] px-3.5 py-2.5"><span class="min-w-0 flex-1"><span class="block text-[14px] font-semibold">{k}</span>{#if h}<span class="block text-[13px] faint">{h}</span>{/if}</span><span class="shrink-0 text-[14.5px] font-semibold num">{grosz(v)}</span></div>
            {/each}
          </div>
          <button class="pill pill-sm mt-3" onclick={() => go(`/chat?q=${encodeURIComponent(tr('Rozpisz należności od CK: kwota firmy, co potwierdzają dokumenty, faktury bez statusu i czego brakuje', 'Break down receivables from CK: company figure, confirmed, without status, missing'))}`)}><Icon name="ask" size={13} />{tr('Rozpisz z AI', 'Break down with AI')}</button>
        </Panel>
      {/if}
    </div>
  {/if}
  {#if !hits && (!category || (dashLoaded && !dash && !building))}
    <div class="mt-4 grid gap-4 xl:grid-cols-2">
      {#if byMonth.length > 1}
        <Panel title={money.length ? tr('Faktury w czasie (brutto, bez dubli)', 'Invoices over time (gross, no duplicates)') : tr('Dokumenty w czasie', 'Documents over time')} sub={tr('wg daty wystawienia', 'by issue date')} icon="calendar" group="locations" i={3}>
          <Chart height={320} rows={byMonth} spec={money.length ? { chart: 'bar', x: 'label', y: ['kwota'], format: 'pln', group: 'locations', labels: { kwota: tr('Kwota', 'Amount') } } : { chart: 'bar', x: 'label', y: ['dokumenty'], format: 'int', group: 'managers', labels: { dokumenty: tr('Dokumenty', 'Documents') } }} />
        </Panel>
      {/if}
      {#if byParty.length > 1}
        <Panel title={tr('Sprzedaż wg firmy (bez dubli)', 'Invoicing by company (no duplicates)')} sub={tr('firmy scalone po NIP', 'companies merged by tax ID')} icon="users" group="managers" i={4}>
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

    <div class="mt-4 grid gap-4 xl:grid-cols-3">
      <Panel class="xl:col-span-2" title={tr('Wyciągi z najnowszych dokumentów', 'Excerpts from the latest documents')} sub={tr('krótko: czego dotyczą', 'in short: what they are about')} icon="report" i={7}>
        <div class="grid gap-2.5 md:grid-cols-2">
          {#each recent as d, i (d.id)}
            <a class="block rounded-2xl bg-white/[0.025] p-4 transition hover:bg-white/[0.05] rise" style="--i:{i}" href={href(`/docs/${d.id}`)}>
              <div class="flex items-center gap-2 text-[13px] faint"><span class="badge">{d.doc_type ?? 'dokument'}</span><span>{fdate(d.doc_date)}</span>{#if d.gross !== null}<span class="ml-auto font-semibold text-[#f4f4f5] num">{pln(d.gross, true)}</span>{/if}</div>
              <div class="mt-2 truncate text-[15px] font-semibold">{d.title}</div>
              <p class="mt-1 line-clamp-3 text-[14px] leading-relaxed muted">{d.summary}</p>
            </a>
          {/each}
        </div>
      </Panel>
      <div class="space-y-4">
        {#if topInv.length}
          <Panel title={tr('Największe faktury', 'Largest invoices')} icon="coins" group="locations" i={8}>
            <div class="space-y-1.5">
              {#each topInv as r (r.key)}
                <a class="flex items-center gap-3 rounded-xl bg-white/[0.025] px-3.5 py-2.5 transition hover:bg-white/[0.05]" href={r.main_doc ? href(`/docs/${r.main_doc}`) : undefined}>
                  <span class="min-w-0 flex-1"><span class="block truncate text-[14px] font-semibold">{r.seller_code} {r.number}</span><span class="block truncate text-[13px] faint">{r.pay_status} · {fdate(r.issue_date)}</span></span>
                  <span class="shrink-0 text-[14.5px] font-semibold num">{pln(amt(r), true)}</span>
                </a>
              {/each}
            </div>
          </Panel>
        {/if}
        {#if !category && fin.checks.length}
          <Panel title={tr('Do wyjaśnienia w finansach', 'Finance items to clarify')} sub={tr('znalezione przy sprawdzaniu faktur i zestawień', 'found while reconciling invoices and registries')} icon="alert" group="alerts" i={9}>
            <div class="space-y-1.5">
              {#each fin.checks.filter((c) => c.level === 'error').concat(fin.checks.filter((c) => c.level === 'warn').slice(0, 3)) as c, i (i)}
                <p class="rounded-xl bg-white/[0.025] px-3.5 py-2.5 text-[13.5px] leading-relaxed {c.level === 'error' ? 'text-[#f59a98]' : 'muted'}">{c.msg}</p>
              {/each}
            </div>
            <button class="pill pill-sm mt-3" onclick={() => go(`/chat?q=${encodeURIComponent(tr('Pokaż wszystkie rozbieżności w finansach (fin_checks): co, ile i co z tym zrobić', 'Show all finance discrepancies: what, how much and what to do'))}`)}><Icon name="ask" size={13} />{tr('Wszystkie', 'All')} · {fin.checks.length}</button>
          </Panel>
        {/if}
        {#if topics.length}
          <Panel title={tr('Tematy', 'Topics')} sub={tr('kliknij, aby przeszukać treść', 'click to search the content')} icon="layers" i={9}>
            <div class="flex flex-wrap gap-2">
              {#each topics as [name, n]}<button class="pill pill-sm" onclick={() => { q = name; void search(); window.scrollTo(0, 0); document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' }); }}>{name}<span class="faint">{n}</span></button>{/each}
            </div>
          </Panel>
        {/if}
      </div>
    </div>
  {/if}
{/if}
