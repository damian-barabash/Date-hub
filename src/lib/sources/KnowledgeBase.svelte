<script lang="ts">
  // База знаний: все документы (только текст) — поиск, фильтры, просмотр, удаление.
  import { supabase } from '../supabase';
  import { docs, loadDocStats, type Doc } from '../docs/store.svelte';
  import { toast } from '../stores/app.svelte';
  import { csvDownload } from '../data/api';
  import { i18n, t, tr } from '../i18n.svelte';
  import { go, route } from '../router.svelte';
  import { int, pln } from '../format';
  import Icon from '../ui/Icon.svelte';

  const PER = 25;
  let q = $state('');
  let cat = $state(route.query.get('cat') ?? '');
  let type = $state('');
  let page = $state(0);
  let sort = $state<{ by: string; dir: 1 | -1 }>({ by: 'doc_date', dir: -1 });
  let rows = $state<Doc[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let picked = $state<Record<string, boolean>>({});
  let busy = $state(false);
  let tick = $state(0);
  const COLS = 'id,title,path,ext,category,doc_type,summary,doc_date,counterparty,number,net,gross,chars,ocr,status,created_at';

  const build = () => {
    let x = supabase.from('documents').select(COLS, { count: 'exact' });
    if (q.trim()) x = x.ilike('title', `%${q.trim().replace(/[%_]/g, ' ')}%`);
    if (cat) x = x.eq('category', cat);
    if (type) x = x.eq('doc_type', type);
    return x;
  };
  $effect(() => {
    void q; void cat; void type; void page; void sort; void tick; void docs.stats?.total;
    let alive = true; loading = true;
    const h = setTimeout(() => {
      build().order(sort.by, { ascending: sort.dir === 1, nullsFirst: false }).range(page * PER, page * PER + PER - 1)
        .then(({ data, count }) => { if (alive) { rows = (data ?? []) as unknown as Doc[]; total = count ?? 0; loading = false; } });
    }, 180);
    return () => { alive = false; clearTimeout(h); };
  });
  let first = true;
  $effect(() => { void q; void cat; void type; if (first) { first = false; return; } page = 0; picked = {}; });

  const ids = $derived(Object.keys(picked).filter((k) => picked[k]));
  const pages = $derived(Math.max(1, Math.ceil(total / PER)));
  const allOn = $derived(rows.length > 0 && rows.every((r) => picked[r.id]));
  const th = (by: string) => () => (sort = { by, dir: sort.by === by ? (sort.dir === 1 ? -1 : 1) : -1 });
  const arrow = (by: string) => (sort.by === by ? (sort.dir === -1 ? ' ↓' : ' ↑') : '');
  const fdate = (s: string | null) => (s ? new Date(s).toLocaleDateString(i18n.lang === 'en' ? 'en-GB' : 'pl-PL') : '—');

  async function removeIds(list: string[], label: string) {
    if (!list.length || !confirm(`${tr('Usunąć z bazy wiedzy', 'Delete from the knowledge base')}: ${label}? ${tr('Tej operacji nie można cofnąć.', 'This cannot be undone.')}`)) return;
    busy = true;
    for (let i = 0; i < list.length; i += 200) {
      const { error } = await supabase.from('documents').delete().in('id', list.slice(i, i + 200));
      if (error) { toast(error.message, 'err'); break; }
    }
    busy = false; picked = {};
    await loadDocStats(); tick++;
    toast(tr('Usunięto', 'Deleted'));
  }
  async function removeFiltered() {
    const { data } = await build().select('id').limit(5000);
    await removeIds((data ?? []).map((r: any) => r.id), `${int(total)} ${tr('dokumentów z bieżącego filtra', 'documents in the current filter')}`);
  }
  async function exportCsv() {
    const { data } = await build().order('doc_date', { ascending: false, nullsFirst: false }).limit(5000);
    csvDownload('baza-wiedzy', (data ?? []).map((d: any) => ({ tytul: d.title, zakladka: d.category, rodzaj: d.doc_type, data: d.doc_date, kontrahent: d.counterparty, numer: d.number, netto: d.net, brutto: d.gross, folder: d.path })));
  }
</script>

<div>
  <div class="mb-4 flex flex-wrap gap-2">
    <div class="relative min-w-[220px] flex-1">
      <span class="absolute top-1/2 left-3.5 -translate-y-1/2 faint"><Icon name="search" size={15} /></span>
      <input class="input !pl-10" placeholder={tr('Szukaj po nazwie dokumentu…', 'Search by document name…')} bind:value={q} />
    </div>
    <select class="input !w-auto min-w-[190px]" bind:value={cat}><option value="">{tr('Zakładka', 'Tab')}: {t('common.all')}</option>{#each docs.stats?.cats ?? [] as c}<option value={c.category}>{c.category} ({c.n})</option>{/each}</select>
    <select class="input !w-auto min-w-[170px]" bind:value={type}><option value="">{tr('Rodzaj', 'Type')}: {t('common.all')}</option>{#each docs.stats?.types ?? [] as x}<option value={x.doc_type}>{x.doc_type} ({x.n})</option>{/each}</select>
  </div>

  <div class="mb-3 flex flex-wrap items-center gap-2 text-[14px]">
    <span class="muted">{int(total)} {tr('dokumentów', 'documents')}{ids.length ? ` · ${ids.length} ${tr('zaznaczonych', 'selected')}` : ''}</span>
    <div class="ml-auto flex flex-wrap gap-2">
      {#if ids.length}<button class="pill pill-sm" data-group="alerts" disabled={busy} onclick={() => removeIds(ids, `${ids.length} ${tr('zaznaczonych', 'selected')}`)}><Icon name="trash" size={13} />{tr('Usuń zaznaczone', 'Delete selected')}</button>{/if}
      {#if (q || cat || type) && total}<button class="pill pill-sm" data-group="alerts" disabled={busy} onclick={removeFiltered}><Icon name="trash" size={13} />{tr('Usuń wszystkie z filtra', 'Delete all in filter')} ({int(total)})</button>{/if}
      <button class="pill pill-sm" onclick={exportCsv}><Icon name="download" size={13} />CSV</button>
    </div>
  </div>

  <div class="overflow-x-auto">
    <table class="table">
      <thead><tr>
        <th class="w-8"><input type="checkbox" class="h-4 w-4 accent-[#ff6a3d]" aria-label="all" checked={allOn} onchange={(e) => { const on = (e.target as HTMLInputElement).checked; for (const r of rows) picked[r.id] = on; }} /></th>
        <th><button class:on={sort.by === 'title'} onclick={th('title')}>{tr('Dokument', 'Document')}{arrow('title')}</button></th>
        <th><button class:on={sort.by === 'category'} onclick={th('category')}>{tr('Zakładka', 'Tab')}{arrow('category')}</button></th>
        <th><button class:on={sort.by === 'doc_type'} onclick={th('doc_type')}>{tr('Rodzaj', 'Type')}{arrow('doc_type')}</button></th>
        <th><button class:on={sort.by === 'doc_date'} onclick={th('doc_date')}>{tr('Data', 'Date')}{arrow('doc_date')}</button></th>
        <th class="r"><button class:on={sort.by === 'gross'} onclick={th('gross')}>{tr('Kwota', 'Amount')}{arrow('gross')}</button></th>
        <th></th>
      </tr></thead>
      <tbody>
        {#each rows as d (d.id)}
          <tr class="clickable" onclick={() => go(`/docs/${d.id}`)}>
            <td onclick={(e) => e.stopPropagation()}><input type="checkbox" class="h-4 w-4 accent-[#ff6a3d]" aria-label={d.title} bind:checked={picked[d.id]} /></td>
            <td class="max-w-[380px]"><div class="truncate font-semibold">{d.title}</div><div class="truncate text-[13px] faint">{d.status === 'new' ? tr('w kolejce do uporządkowania…', 'waiting to be organised…') : d.path || '—'}</div></td>
            <td class="max-w-[180px] truncate muted">{d.category ?? '—'}</td>
            <td>{#if d.doc_type}<span class="badge">{d.doc_type}</span>{/if}</td>
            <td class="num muted">{fdate(d.doc_date)}</td>
            <td class="r num">{d.gross !== null ? pln(d.gross) : d.net !== null ? pln(d.net) : '—'}</td>
            <td class="r" onclick={(e) => e.stopPropagation()}><button class="icon-btn !h-8 !w-8" aria-label={tr('Usuń', 'Delete')} title={tr('Usuń', 'Delete')} disabled={busy} onclick={() => removeIds([d.id], `«${d.title}»`)}><Icon name="trash" size={14} /></button></td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if !loading && !rows.length}
      <div class="py-10 text-center">
        <div class="muted">{total === 0 && !q && !cat && !type ? tr('Baza wiedzy jest pusta — dodaj dokumenty powyżej', 'The knowledge base is empty — add documents above') : tr('Brak dokumentów dla tych filtrów', 'No documents match these filters')}</div>
        {#if q || cat || type}<button class="pill mt-4" onclick={() => { q = ''; cat = ''; type = ''; }}>{tr('Wyczyść filtry', 'Clear filters')}</button>{/if}
      </div>
    {/if}
  </div>
  <div class="mt-4 flex items-center justify-between text-[14px]">
    <span class="faint">{tr('Strona', 'Page')} {page + 1} / {pages}</span>
    <div class="flex gap-2">
      <button class="icon-btn" disabled={page === 0} onclick={() => page--} aria-label="prev"><Icon name="left" size={16} /></button>
      <button class="icon-btn" disabled={page >= pages - 1} onclick={() => page++} aria-label="next"><Icon name="right" size={16} /></button>
    </div>
  </div>
</div>
