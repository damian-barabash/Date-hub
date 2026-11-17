<script lang="ts">
  // Загрузка Excel / CSV / JSON: разбор в воркере → предпросмотр и роли → импорт пакетами → финализация.
  // Если файл похож на справочник точек (код + город + адрес) — предлагает загрузить его в справочник.
  import { fly, slide } from 'svelte/transition';
  import { supabase } from '../supabase';
  import { geocodeAll } from '../data/geocode';
  import { app, loadDatasets, loadLocations, toast } from '../stores/app.svelte';
  import { chunks, type Column, type Inferred, type Role } from '../data/infer';
  import { clearCache } from '../data/api';
  import { t, tr } from '../i18n.svelte';
  import { go } from '../router.svelte';
  import { int } from '../format';
  import Icon from '../ui/Icon.svelte';

  const ROLES: Role[] = ['manager', 'employee', 'location', 'customer', 'product', 'product_id', 'category', 'brand', 'qty', 'net', 'gross', 'margin', 'profit', 'cost', 'price', 'date', 'city', 'region', 'lat', 'lng'];

  let drag = $state(false);
  let file = $state<File | null>(null);
  let parsing = $state(false);
  let err = $state('');
  let sheets = $state<string[]>([]);
  let sheet = $state('');
  let inf = $state<Inferred | null>(null);
  let name = $state('');
  let period = $state('');
  let mode = $state<'dataset' | 'directory'>('dataset');
  let dirMap = $state<Record<string, string>>({});
  let progress = $state<{ done: number; total: number; phase: string } | null>(null);
  let doneInfo = $state<{ rows: number; id?: string; directory?: boolean } | null>(null);
  let input: HTMLInputElement;
  let worker: Worker | null = null;

  const DIR_FIELDS = [
    { k: 'code', l: () => tr('Kod punktu (jak w sprzedaży)', 'Point code (as in sales)'), re: /^(nazwa|kod_sklepu|kod_punktu|magazyn|symbol|code|sklep)$/ },
    { k: 'name', l: () => tr('Nazwa własna', 'Display name'), re: /(nazwa_wlasna|nazwa_handlowa|display|label)/ },
    { k: 'city', l: () => tr('Miasto', 'City'), re: /(miasto|city|miejscowosc)/ },
    { k: 'street', l: () => tr('Adres (ulica)', 'Address (street)'), re: /^(adres|ulica|address|street)$/ },
    { k: 'postal', l: () => tr('Kod pocztowy', 'Postal code'), re: /^(kod|kod_pocztowy|postal|zip)$/ },
    { k: 'branch', l: () => tr('Oddział / region', 'Branch / region'), re: /(oddzial|branch|region)/ },
    { k: 'kind', l: () => tr('Rodzaj', 'Type'), re: /(rodzaj|typ|kind|type)/ },
    { k: 'email', l: () => 'E-mail', re: /(e_mail|email|mail)/ },
    { k: 'store_id', l: () => 'ID', re: /^(id|id_sklepu|store_id)$/ },
  ];

  function detectDirectory(x: Inferred) {
    const cols = x.columns.filter((c) => !c.derived).map((c) => c.key);
    const known = new Set(app.locations.map((l) => l.code));
    const map: Record<string, string> = {};
    // код: колонка с максимальным совпадением с известными кодами точек
    let bestCol = '', best = 0;
    for (const c of cols) {
      const vals = x.rows.slice(0, 500).map((r) => String(r[c] ?? ''));
      const hit = known.size ? vals.filter((v) => known.has(v)).length / Math.max(vals.length, 1) : 0;
      if (hit > best) { best = hit; bestCol = c; }
    }
    for (const f of DIR_FIELDS) {
      if (f.k === 'code' && best >= 0.3) { map.code = bestCol; continue; }
      const c = cols.find((k) => f.re.test(k) && !Object.values(map).includes(k) && (f.k !== 'street' || !x.rows.slice(0, 20).some((r) => String(r[k] ?? '').includes('@'))));
      if (c) map[f.k] = c;
    }
    if (!map.code) map.code = x.roles.location ?? cols.find((k) => /^nazwa$/.test(k)) ?? '';
    dirMap = map;
    const looksDir = !!map.code && !!map.city && !!map.street && !x.roles.net && !x.roles.gross && x.rows.length < 20000;
    mode = looksDir ? 'directory' : 'dataset';
  }

  function ensureWorker() {
    worker ??= new Worker(new URL('../data/parse.worker.ts', import.meta.url), { type: 'module' });
    return worker;
  }

  async function pick(f: File) {
    file = f; err = ''; inf = null; doneInfo = null; parsing = true;
    name = f.name.replace(/\.[^.]+$/, '');
    const w = ensureWorker();
    w.onmessage = (e) => {
      parsing = false;
      if (!e.data.ok) { err = e.data.error; return; }
      sheets = e.data.sheets; sheet = e.data.sheet; inf = e.data.inferred;
      period = inf!.meta.period ?? '';
      detectDirectory(inf!);
    };
    w.postMessage({ type: 'open', buf: await f.arrayBuffer(), name: f.name });
  }
  function changeSheet(s: string) {
    parsing = true; sheet = s;
    worker!.postMessage({ type: 'sheet', sheet: s });
  }
  function onDrop(e: DragEvent) { e.preventDefault(); drag = false; const f = e.dataTransfer?.files?.[0]; if (f) void pick(f); }

  function setRole(c: Column, role: string) {
    if (!inf) return;
    for (const [r, k] of Object.entries(inf.roles)) if (k === c.key || r === role) { delete (inf.roles as any)[r]; const cc = inf.columns.find((x) => x.key === k); if (cc) cc.role = undefined; }
    if (role) { (inf.roles as any)[role] = c.key; c.role = role as Role; }
  }

  async function importDataset() {
    if (!inf) return;
    progress = { done: 0, total: inf.rows.length, phase: tr('Tworzę tabelę', 'Creating table') };
    try {
      const { data: id, error } = await supabase.rpc('ds_create', {
        p_name: name || 'Dane', p_columns: inf.columns, p_roles: inf.roles, p_source: 'file',
        p_meta: { period: period || undefined, notes: inf.meta.notes, file: file?.name, sheet },
      });
      if (error) throw error;
      const parts = chunks(inf.rows, 4000);
      let done = 0;
      // 3 параллельных потока загрузки
      const queue = [...parts];
      progress.phase = t('src.importing');
      await Promise.all([0, 1, 2].map(async () => {
        for (let p = queue.shift(); p; p = queue.shift()) {
          const { error: e } = await supabase.rpc('ds_insert', { p_id: id, p_rows: p });
          if (e) throw e;
          done += p.length; progress = { ...progress!, done };
        }
      }));
      progress = { ...progress!, phase: tr('Analizuję kolumny', 'Profiling columns') };
      const { error: fe } = await supabase.rpc('ds_finalize', { p_id: id });
      if (fe) throw fe;
      await supabase.rpc('ds_set_active', { p_id: id });
      clearCache();
      await Promise.all([loadDatasets(), loadLocations()]);
      doneInfo = { rows: inf.rows.length, id: id as string };
      progress = null; inf = null; file = null;
      toast(t('src.done'));
      void runGeocode();
    } catch (e: any) {
      progress = null; err = e?.message ?? String(e);
    }
  }

  async function importDirectory() {
    if (!inf) return;
    const m = dirMap;
    const rows = inf.rows.filter((r) => r[m.code]).map((r) => Object.fromEntries(DIR_FIELDS.map((f) => [f.k, m[f.k] ? (r[m[f.k]] ?? null) : null])));
    progress = { done: 0, total: rows.length, phase: tr('Aktualizuję słownik punktów', 'Updating point directory') };
    const { data, error } = await supabase.rpc('locations_import', { p_rows: rows });
    if (error) { progress = null; err = error.message; return; }
    await loadLocations();
    progress = null; inf = null; file = null;
    doneInfo = { rows: Number(data), directory: true };
    toast(t('src.done'));
    void runGeocode();
  }

  let geo = $state('');
  async function runGeocode() {
    try {
      let n = 0;
      await geocodeAll(loadLocations, (left) => { geo = left ? `${t('map.geocoding')}: ${left} ${tr('pozostało', 'left')}…` : ''; if (++n % 10 === 0) void loadLocations(); });
    } catch (e) { geo = String(e); return; }
    geo = '';
  }
  const pct = $derived(progress ? Math.round((progress.done / Math.max(progress.total, 1)) * 100) : 0);
</script>

<div data-group="locations">
  {#if !inf && !progress}
    <button class="drop w-full" class:on={drag} onclick={() => input.click()}
      ondragover={(e) => { e.preventDefault(); drag = true; }} ondragleave={() => (drag = false)} ondrop={onDrop}>
      <div class="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-white/10 muted">
        {#if parsing}<span class="spin inline-block h-6 w-6 rounded-full border-2 border-white/20 border-t-[var(--g)]"></span>{:else}<Icon name="upload" size={28} />{/if}
      </div>
      <div class="mt-5 text-[22px] font-medium tracking-[-0.02em]">{parsing ? t('src.parsing') : t('src.drop')}</div>
      <div class="mt-1 text-[14px] faint">{t('src.drop.sub')}</div>
    </button>
    <input bind:this={input} type="file" accept=".xlsx,.xls,.xlsm,.csv,.json,.ods" class="hidden" onchange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void pick(f); (e.target as HTMLInputElement).value = ''; }} />
  {/if}

  {#if err}<div class="mt-4 rounded-2xl border border-[#f04438]/30 bg-[#f04438]/[0.06] px-4 py-3 text-[14px] text-[#ffb0b0]">{err}</div>{/if}
  {#if geo}<div class="mt-4 flex items-center gap-2 text-[14px] muted"><span class="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-white/20 border-t-[var(--g)]"></span>{geo}</div>{/if}

  {#if doneInfo}
    <div class="card mt-4 flex flex-wrap items-center gap-4 p-5 rise" data-group="finance">
      <span class="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--g)] text-black"><Icon name="check" size={22} stroke={2.6} /></span>
      <div class="flex-1">
        <div class="text-[16px] font-semibold">{t('src.done')}</div>
        <div class="text-[14px] muted">{int(doneInfo.rows)} {doneInfo.directory ? tr('punktów w słowniku', 'points in directory') : t('common.rows')}</div>
      </div>
      {#if !doneInfo.directory}
        <button class="pill" onclick={() => go('/explore')}><Icon name="compass" size={15} />{t('nav.explore')}</button>
        <button class="pill pill-accent" onclick={() => go('/sales')}><Icon name="grid" size={15} />{t('nav.overview')}</button>
      {:else}
        <button class="pill pill-accent" onclick={() => go('/map')}><Icon name="map" size={15} />{t('nav.map')}</button>
      {/if}
    </div>
  {/if}

  {#if progress}
    <div class="card mt-2 p-6 rise">
      <div class="mb-3 flex justify-between text-[15px] font-bold"><span>{progress.phase}</span><span class="num">{int(progress.done)} / {int(progress.total)}</span></div>
      <div class="h-3 overflow-hidden rounded-full bg-white/[0.06]">
        <div class="h-full rounded-full bg-[#ff6a3d] transition-all duration-500" style="width:{pct}%"></div>
      </div>
    </div>
  {/if}

  {#if inf && !progress}
    <div class="mt-2 space-y-4" in:fly={{ y: 10, duration: 400 }}>
      <div class="flex flex-wrap items-center gap-3">
        <span class="pill"><Icon name="layers" size={15} />{file?.name}</span>
        <span class="text-[14px] muted">{int(inf.rows.length)} {t('common.rows')} · {inf.columns.length} {tr('kolumn', 'columns')}{inf.meta.skipped ? ` · ${inf.meta.skipped} ${tr('pominięto (notatki/puste)', 'skipped (notes/empty)')}` : ''}</span>
        {#if sheets.length > 1}
          <select class="input !h-9 !w-auto" value={sheet} onchange={(e) => changeSheet((e.target as HTMLSelectElement).value)}>
            {#each sheets as s}<option>{s}</option>{/each}
          </select>
        {/if}
        <button class="pill pill-sm ml-auto" onclick={() => { inf = null; file = null; }}><Icon name="x" size={13} />{t('common.cancel')}</button>
      </div>

      <div class="flex rounded-full border border-white/10 bg-[#151517] p-1 text-[13.5px] font-bold w-fit">
        <button class="rounded-full px-4 py-2" class:bg-[var(--g)]={mode === 'dataset'} class:text-black={mode === 'dataset'} onclick={() => (mode = 'dataset')}>{tr('Zbiór danych do analizy', 'Dataset for analysis')}</button>
        <button class="rounded-full px-4 py-2" class:bg-[var(--g)]={mode === 'directory'} class:text-black={mode === 'directory'} onclick={() => (mode = 'directory')}>{tr('Słownik punktów (adresy)', 'Point directory (addresses)')}</button>
      </div>

      {#if inf.meta.notes.length}
        <div class="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-[13.5px] muted" transition:slide>
          <b class="text-white">{tr('Notatki z eksportu', 'Export notes')}:</b> {inf.meta.notes.join(' · ').replace(/\n/g, ' · ')}
        </div>
      {/if}

      {#if mode === 'dataset'}
        <div class="grid gap-3 md:grid-cols-2">
          <div><label class="label" for="dsn">{t('src.name')}</label><input id="dsn" class="input" bind:value={name} /></div>
          <div><label class="label" for="dsp">{t('src.period')}</label><input id="dsp" class="input" bind:value={period} placeholder="2025-11" /></div>
        </div>
        <div class="card overflow-x-auto p-4">
          <div class="mb-3 text-[14px] font-bold">{t('src.detected')}</div>
          <table class="table">
            <thead><tr><th>{t('src.column')}</th><th>{t('src.type')}</th><th>{t('src.role')}</th><th>{tr('Przykład', 'Example')}</th></tr></thead>
            <tbody>
              {#each inf.columns as c (c.key)}
                <tr>
                  <td><div class="font-bold">{c.label}</div><div class="text-[12.5px] faint"><code>{c.key}</code>{c.derived ? ` · auto: ${c.derived.op}` : ''}</div></td>
                  <td>
                    {#if c.derived}<span class="badge">{c.type}</span>{:else}
                      <select class="input !h-8 !w-auto !text-[13px]" bind:value={c.type}>
                        {#each ['text', 'number', 'integer', 'date', 'datetime', 'boolean'] as ty}<option>{ty}</option>{/each}
                      </select>
                    {/if}
                  </td>
                  <td>
                    <select class="input !h-8 !w-auto !text-[13px]" value={c.role ?? ''} onchange={(e) => setRole(c, (e.target as HTMLSelectElement).value)}>
                      <option value="">—</option>
                      {#each ROLES as r}<option value={r}>{i18nRole(r)}</option>{/each}
                    </select>
                  </td>
                  <td class="max-w-[240px] truncate text-[13.5px] muted">{String(inf.rows.find((r) => r[c.key] !== null && r[c.key] !== undefined)?.[c.key] ?? '—')}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <button class="pill pill-accent !h-12 !px-6 !text-[15px]" onclick={importDataset}><Icon name="upload" size={16} />{t('src.import')} · {int(inf.rows.length)} {t('common.rows')}</button>
      {:else}
        <div class="card p-5">
          <div class="mb-1 text-[14px] font-bold">{tr('Mapowanie pól słownika', 'Directory field mapping')}</div>
          <p class="mb-4 text-[13.5px] faint">{tr('Kod punktu musi odpowiadać kolumnie punktu/magazynu w danych sprzedaży. Adresy zostaną zgeokodowane na mapie.', 'The point code must match the point/warehouse column in sales data. Addresses will be geocoded on the map.')}</p>
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {#each DIR_FIELDS as f}
              <div>
                <label class="label" for="df-{f.k}">{f.l()}</label>
                <select id="df-{f.k}" class="input" bind:value={dirMap[f.k]}>
                  <option value="">—</option>
                  {#each inf.columns.filter((c) => !c.derived) as c}<option value={c.key}>{c.label}</option>{/each}
                </select>
              </div>
            {/each}
          </div>
          {#if dirMap.code}
            <div class="mt-4 text-[13.5px] muted">
              {tr('Zgodność z punktami w danych', 'Match with points in data')}:
              <b class="text-white">{int(inf.rows.filter((r) => app.locations.some((l) => l.code === String(r[dirMap.code]))).length)}</b> / {int(inf.rows.length)}
            </div>
          {/if}
        </div>
        <button class="pill pill-accent !h-12 !px-6 !text-[15px]" disabled={!dirMap.code} onclick={importDirectory}><Icon name="pin" size={16} />{tr('Zapisz słownik punktów', 'Save point directory')}</button>
      {/if}
    </div>
  {/if}
</div>

<script lang="ts" module>
  import { i18n } from '../i18n.svelte';
  const EN: Record<string, string> = { manager: 'Manager', employee: 'Employee', location: 'Point / warehouse', customer: 'Customer', product: 'Product (name)', product_id: 'Product (code)', category: 'Category', brand: 'Brand', qty: 'Quantity', net: 'Net revenue', gross: 'Gross revenue', margin: 'Margin (0–1)', profit: 'Profit', cost: 'Cost', price: 'Price', date: 'Date', city: 'City', region: 'Region', lat: 'Latitude', lng: 'Longitude' };
  const PLR: Record<string, string> = { manager: 'Kierownik', employee: 'Pracownik', location: 'Punkt / magazyn', customer: 'Klient', product: 'Produkt (nazwa)', product_id: 'Produkt (kod)', category: 'Kategoria', brand: 'Marka', qty: 'Ilość', net: 'Przychód netto', gross: 'Przychód brutto', margin: 'Marża (0–1)', profit: 'Zysk', cost: 'Koszt', price: 'Cena', date: 'Data', city: 'Miasto', region: 'Region', lat: 'Szer. geogr.', lng: 'Dł. geogr.' };
  export const i18nRole = (r: string) => (i18n.lang === 'en' ? EN[r] : PLR[r]) ?? r;
</script>

<style>
  .drop { border: 1px dashed rgb(255 255 255 / 0.18); border-radius: 20px; padding: 56px 24px; text-align: center; transition: background .3s, border-color .3s; }
  .drop:hover, .drop.on { background: rgb(255 255 255 / 0.03); border-color: rgb(255 255 255 / 0.4); }
</style>
