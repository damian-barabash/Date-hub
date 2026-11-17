<script lang="ts">
  // Подключения: REST/POS API, файл по ссылке (CSV/XLSX/JSON, Google Sheets), PostgreSQL, MySQL.
  // Секреты (токены, пароли) уходят только на сервер и в браузер не возвращаются.
  import { slide } from 'svelte/transition';
  import { supabase, fn } from '../supabase';
  import { loadDatasets, loadLocations, toast } from '../stores/app.svelte';
  import { clearCache } from '../data/api';
  import { t, tr } from '../i18n.svelte';
  import { dateTime, int } from '../format';
  import Icon from '../ui/Icon.svelte';

  type Conn = { id: string; name: string; kind: string; config: any; schedule_minutes: number | null; mode: string; dataset_id: string | null; last_sync_at: string | null; last_status: string | null; last_error: string | null };
  let list = $state<Conn[]>([]);
  let open = $state(false);
  let busy = $state('');
  let preview = $state<{ total: number; columns: any[]; preview: any[] } | null>(null);
  let err = $state('');

  const KINDS = [
    { k: 'rest', l: () => tr('API / POS (REST JSON)', 'API / POS (REST JSON)'), icon: 'bolt' },
    { k: 'file_url', l: () => tr('Plik z linku (CSV / XLSX / JSON, Google Sheets)', 'File by URL (CSV / XLSX / JSON, Google Sheets)'), icon: 'link' },
    { k: 'postgres', l: () => 'PostgreSQL', icon: 'database' },
    { k: 'mysql', l: () => 'MySQL / MariaDB', icon: 'database' },
  ];
  const PRESETS = [
    { name: 'NBP — kursy walut (tabela A)', kind: 'rest', config: { url: 'https://api.nbp.pl/api/exchangerates/tables/A?format=json', path: '0.rates' } },
    { name: 'Google Sheets (CSV)', kind: 'file_url', config: { url: 'https://docs.google.com/spreadsheets/d/<ID>/export?format=csv' } },
  ];

  let form = $state({ id: '', name: '', kind: 'rest', url: '', method: 'GET', path: '', headers: '', secretHeader: '', secretValue: '', conn: '', query: '', sheet: '', schedule: '', mode: 'replace', pageParam: '', pageMax: '' });

  async function refresh() {
    const { data } = await supabase.from('connectors').select('*').order('created_at', { ascending: false });
    list = (data ?? []) as Conn[];
  }
  $effect(() => { void refresh(); });

  function build() {
    const f = form;
    let headers: Record<string, string> = {};
    if (f.headers.trim()) { try { headers = JSON.parse(f.headers); } catch { throw new Error(tr('Nagłówki: niepoprawny JSON', 'Headers: invalid JSON')); } }
    const config: any = f.kind === 'rest' ? { url: f.url, method: f.method, path: f.path || undefined, headers, ...(f.pageParam ? { pagination: { param: f.pageParam, max: Number(f.pageMax) || 20 } } : {}) }
      : f.kind === 'file_url' ? { url: f.url, sheet: f.sheet || undefined, path: f.path || undefined }
      : { query: f.query };
    const secret: any = f.kind === 'rest' || f.kind === 'file_url' ? (f.secretHeader && f.secretValue ? { headers: { [f.secretHeader]: f.secretValue } } : {}) : (f.conn ? { url: f.conn } : {});
    return { config, secret };
  }
  async function test() {
    err = ''; preview = null; busy = 'test';
    try { const { config, secret } = build(); preview = await fn('connect', { action: 'test', kind: form.kind, config, secret }); }
    catch (e) { err = e instanceof Error ? e.message : String(e); }
    busy = '';
  }
  async function save() {
    err = ''; busy = 'save';
    try {
      const { config, secret } = build();
      const { id } = await fn<{ id: string }>('connect', { action: 'save', id: form.id || undefined, name: form.name || 'Źródło', kind: form.kind, config, secret, schedule_minutes: form.schedule || null, mode: form.mode });
      busy = 'sync';
      const r = await fn<{ rows: number }>('connect', { action: 'sync', id });
      toast(`${t('src.done')}: ${int(r.rows)} ${t('common.rows')}`);
      open = false; preview = null; clearCache();
      await Promise.all([refresh(), loadDatasets(), loadLocations()]);
    } catch (e) { err = e instanceof Error ? e.message : String(e); await refresh(); }
    busy = '';
  }
  async function sync(c: Conn) {
    busy = c.id;
    try { const r = await fn<{ rows: number }>('connect', { action: 'sync', id: c.id }); toast(`${t('src.done')}: ${int(r.rows)} ${t('common.rows')}`); clearCache(); await loadDatasets(); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'err'); }
    busy = ''; await refresh();
  }
  async function del(c: Conn) {
    if (!confirm(t('common.confirm'))) return;
    await fn('connect', { action: 'delete', id: c.id, with_data: confirm(tr('Usunąć także dane tego połączenia?', 'Also delete the data from this connection?')) });
    clearCache(); await Promise.all([refresh(), loadDatasets()]);
  }
  function preset(p: (typeof PRESETS)[number]) {
    form = { ...form, name: p.name, kind: p.kind, url: p.config.url, path: (p.config as any).path ?? '' };
    open = true;
  }
</script>

<div data-group="ai">
  <div class="mb-4 flex flex-wrap gap-2">
    <button class="pill pill-accent" onclick={() => { open = !open; preview = null; err = ''; }}><Icon name="plus" size={15} />{t('src.newConnector')}</button>
    {#each PRESETS as p}<button class="pill" onclick={() => preset(p)}><Icon name="bolt" size={14} />{p.name}</button>{/each}
  </div>

  {#if open}
    <div class="card mb-4 p-5" transition:slide>
      <div class="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {#each KINDS as k}
          <button class="flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-left text-[14px] font-bold transition" class:border-[var(--g)]={form.kind === k.k} class:bg-white={false}
            style={form.kind === k.k ? 'background:rgb(255 255 255 / 0.07); border-color:rgb(255 255 255 / 0.3)' : 'border-color:var(--color-line-2)'} onclick={() => (form.kind = k.k)}>
            <Icon name={k.icon} size={16} />{k.l()}
          </button>
        {/each}
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        <div><label class="label" for="cn">{tr('Nazwa', 'Name')}</label><input id="cn" class="input" bind:value={form.name} placeholder="np. POS — sprzedaż dzienna" /></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label" for="cs">{t('src.schedule')}</label><input id="cs" class="input" type="number" min="15" bind:value={form.schedule} placeholder={tr('ręcznie', 'manual')} /></div>
          <div><label class="label" for="cm">{tr('Tryb', 'Mode')}</label><select id="cm" class="input" bind:value={form.mode}><option value="replace">{tr('Zastąp dane', 'Replace data')}</option><option value="append">{tr('Dopisuj', 'Append')}</option></select></div>
        </div>
        {#if form.kind === 'rest' || form.kind === 'file_url'}
          <div class="md:col-span-2"><label class="label" for="cu">URL</label><input id="cu" class="input" bind:value={form.url} placeholder="https://…" /></div>
          {#if form.kind === 'rest'}
            <div class="grid grid-cols-[110px_1fr] gap-3"><div><label class="label" for="cmeth">{tr('Metoda', 'Method')}</label><select id="cmeth" class="input" bind:value={form.method}><option>GET</option><option>POST</option></select></div>
              <div><label class="label" for="cpath">{tr('Ścieżka do tablicy w JSON', 'Path to array in JSON')}</label><input id="cpath" class="input" bind:value={form.path} placeholder="data.items" /></div></div>
            <div><label class="label" for="ch">{tr('Nagłówki (JSON, bez sekretów)', 'Headers (JSON, no secrets)')}</label><input id="ch" class="input" bind:value={form.headers} placeholder={'{"Accept":"application/json"}'} /></div>
            <div class="grid grid-cols-2 gap-3"><div><label class="label" for="cpp">{tr('Paginacja: parametr', 'Pagination: param')}</label><input id="cpp" class="input" bind:value={form.pageParam} placeholder="page" /></div>
              <div><label class="label" for="cpm">{tr('Maks. stron', 'Max pages')}</label><input id="cpm" class="input" type="number" bind:value={form.pageMax} placeholder="20" /></div></div>
          {:else}
            <div><label class="label" for="csh">{t('src.sheet')}</label><input id="csh" class="input" bind:value={form.sheet} placeholder={tr('pierwszy', 'first')} /></div>
          {/if}
          <div class="grid grid-cols-2 gap-3 md:col-span-2">
            <div><label class="label" for="csh1">{tr('Nagłówek autoryzacji', 'Auth header')}</label><input id="csh1" class="input" bind:value={form.secretHeader} placeholder="Authorization" /></div>
            <div><label class="label" for="csv1">{tr('Wartość (sekret, szyfrowany po stronie serwera)', 'Value (secret, stored server-side)')}</label><input id="csv1" class="input" type="password" bind:value={form.secretValue} placeholder="Bearer …" /></div>
          </div>
        {:else}
          <div class="md:col-span-2"><label class="label" for="cc">{tr('Connection string (sekret)', 'Connection string (secret)')}</label><input id="cc" class="input" type="password" bind:value={form.conn} placeholder={form.kind === 'postgres' ? 'postgresql://user:pass@host:5432/db' : 'mysql://user:pass@host:3306/db'} /></div>
          <div class="md:col-span-2"><label class="label" for="cq">{tr('Zapytanie SQL (tylko odczyt)', 'SQL query (read-only)')}</label><textarea id="cq" class="input font-mono !text-[13.5px]" rows="4" bind:value={form.query} placeholder="SELECT * FROM sprzedaz WHERE data >= current_date - 30"></textarea></div>
        {/if}
      </div>
      {#if err}<div class="mt-4 rounded-xl bg-[#f04438]/10 px-4 py-3 text-[14px] text-[#ffb0b0]">{err}</div>{/if}
      <div class="mt-5 flex flex-wrap gap-2">
        <button class="pill" onclick={test} disabled={!!busy}>{#if busy === 'test'}<span class="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-white/20 border-t-white"></span>{:else}<Icon name="eye" size={15} />{/if}{t('src.test')}</button>
        <button class="pill pill-accent" onclick={save} disabled={!!busy}>{#if busy === 'save' || busy === 'sync'}<span class="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-black/20 border-t-black"></span>{:else}<Icon name="refresh" size={15} />{/if}{tr('Zapisz i synchronizuj', 'Save & sync')}</button>
      </div>
      {#if preview}
        <div class="mt-5" transition:slide>
          <div class="mb-2 text-[14px] font-bold">{int(preview.total)} {t('common.rows')} · {preview.columns.length} {tr('kolumn', 'columns')}</div>
          <div class="max-h-[300px] overflow-auto rounded-xl border border-white/[0.06]">
            <table class="table"><thead><tr>{#each preview.columns as c}<th>{c.label}{c.role ? ` · ${c.role}` : ''}</th>{/each}</tr></thead>
              <tbody>{#each preview.preview.slice(0, 10) as r}<tr>{#each preview.columns as c}<td>{r[c.key] ?? '—'}</td>{/each}</tr>{/each}</tbody></table>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  {#if list.length}
    <div class="space-y-3">
      {#each list as c, i (c.id)}
        <div class="card flex flex-wrap items-center gap-4 p-5 rise" style="--i:{i}" data-group={c.last_status === 'error' ? 'alerts' : 'locations'}>
          <span class="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 muted"><Icon name={KINDS.find((k) => k.k === c.kind)?.icon ?? 'link'} size={19} /></span>
          <div class="min-w-0 flex-1">
            <div class="font-semibold">{c.name}</div>
            <div class="text-[13.5px] faint">{c.kind}{c.schedule_minutes ? ` · ${tr('co', 'every')} ${c.schedule_minutes} min` : ''}{c.last_sync_at ? ` · ${dateTime(c.last_sync_at)}` : ''}</div>
            {#if c.last_error}<div class="mt-1 text-[13px] text-[#ff8f8f]">{c.last_error}</div>{/if}
          </div>
          <button class="pill pill-sm" onclick={() => sync(c)} disabled={!!busy}>{#if busy === c.id}<span class="spin inline-block h-3 w-3 rounded-full border-2 border-white/20 border-t-white"></span>{:else}<Icon name="refresh" size={13} />{/if}{t('src.sync')}</button>
          <button class="pill pill-sm" data-group="alerts" onclick={() => del(c)}><Icon name="trash" size={13} /></button>
        </div>
      {/each}
    </div>
  {/if}
</div>
