<script lang="ts">
  // Загрузка документов: файлы читаются в браузере, на сервер уходит только текст.
  import { extractFile, stopOcr } from '../docs/extract';
  import { analyzeAll, docs, loadDocStats, saveDoc } from '../docs/store.svelte';
  import { app, loadDatasets, loadLocations, toast } from '../stores/app.svelte';
  import { importDataset, importDirectory, inspectSpreadsheet } from '../data/importer';
  import { geocodeAll } from '../data/geocode';
  import { clearCache } from '../data/api';
  import { tr } from '../i18n.svelte';
  import { go } from '../router.svelte';
  import { int } from '../format';
  import Icon from '../ui/Icon.svelte';

  type Item = { name: string; state: 'wait' | 'read' | 'ok' | 'skip' | 'err'; note: string };
  let items = $state<Item[]>([]);
  let busy = $state(false);
  let drag = $state(false);
  let input: HTMLInputElement;
  let dirInput: HTMLInputElement;
  const done = $derived(items.filter((i) => i.state === 'ok').length);
  const skipped = $derived(items.filter((i) => i.state === 'skip' || i.state === 'err').length);

  /** Папка, брошенная мышью: обходим вложенность, чтобы сохранить пути. */
  async function fromDrop(dt: DataTransfer): Promise<{ file: File; path: string }[]> {
    const out: { file: File; path: string }[] = [];
    const walk = async (entry: any, path: string): Promise<void> => {
      if (entry.isFile) out.push({ file: await new Promise<File>((res, rej) => entry.file(res, rej)), path });
      else if (entry.isDirectory) {
        const reader = entry.createReader();
        for (;;) {
          const batch: any[] = await new Promise((res, rej) => reader.readEntries(res, rej));
          if (!batch.length) break;
          for (const e of batch) await walk(e, [path, entry.name].filter(Boolean).join('/'));
        }
      }
    };
    const entries = [...dt.items].map((i) => (i as any).webkitGetAsEntry?.()).filter(Boolean);
    if (entries.length) for (const e of entries) await walk(e, '');
    else for (const f of dt.files) out.push({ file: f, path: '' });
    return out;
  }

  async function run(list: { file: File; path: string }[]) {
    if (!list.length || busy) return;
    busy = true;
    const start = items.length;
    items.push(...list.map((x) => ({ name: [x.path, x.file.name].filter(Boolean).join('/'), state: 'wait' as const, note: '' })));
    let saved = 0; let tables = 0; let dirs = 0;
    for (let i = 0; i < list.length; i++) {
      const it = items[start + i];
      it.state = 'read'; it.note = tr('czytam…', 'reading…');
      try {
        // arkusz: najpierw sprawdzamy, czy to tabela danych (całość → analiza) albo słownik punktów
        const f = list[i].file;
        if (/\.(xlsx|xlsm|xls|csv|ods)$/i.test(f.name)) {
          it.note = tr('rozpoznaję tabelę…', 'recognising the table…');
          const sp = await inspectSpreadsheet(f, new Set(app.locations.map((l) => l.code)));
          if (sp.kind === 'dataset') {
            await importDataset(sp.inf, { name: f.name.replace(/\.[^.]+$/, ''), file: f.name, sheet: sp.sheet }, (d, t, ph) => (it.note = ph === 'finalize' ? tr('analizuję kolumny…', 'profiling columns…') : `${tr('wczytuję', 'loading')} ${int(d)} / ${int(t)}`));
            tables++;
            it.state = 'ok'; it.note = `${tr('tabela danych', 'data table')}: ${int(sp.inf.rows.length)} ${tr('wierszy → analityka', 'rows → analytics')}`;
            if (sp.sheets <= 1) continue; // inne arkusze — dodatkowo jako dokument
          } else if (sp.kind === 'directory') {
            const n = await importDirectory(sp.inf, sp.map);
            dirs++;
            it.state = 'ok'; it.note = `${tr('słownik punktów', 'point directory')}: ${int(n)}`;
            continue;
          }
        }
        const r = await extractFile(f, list[i].path, (m) => (it.note = m));
        for (const d of r.docs) { if (await saveDoc(d)) saved++; }
        if (r.docs.length && it.state === 'ok') it.note += ` · ${tr('także jako dokument', 'also as a document')}`;
        else if (r.docs.length) { it.state = 'ok'; it.note = `${int(r.docs.reduce((a, d) => a + d.text.length, 0))} ${tr('znaków', 'chars')}${r.docs.some((d) => d.ocr) ? ' · OCR' : ''}${r.docs.length > 1 ? ` · ${r.docs.length} ${tr('plików', 'files')}` : ''}`; }
        else { it.state = 'skip'; it.note = r.skipped[0]?.reason ?? tr('pominięte', 'skipped'); }
      } catch (e) { it.state = 'err'; it.note = e instanceof Error ? e.message : String(e); }
    }
    await stopOcr();
    busy = false;
    await loadDocStats();
    if (tables || dirs) {
      clearCache(); await Promise.all([loadDatasets(), loadLocations()]);
      toast(tables ? tr('Tabela danych wczytana w całości — analityka sprzedaży gotowa', 'Data table loaded in full — sales analytics ready') : tr('Słownik punktów zaktualizowany', 'Point directory updated'));
      if (app.locations.some((l) => l.status === 'pending')) void geocodeAll(loadLocations).catch(() => null); // adresy punktów → mapa
    }
    if (saved) { toast(tr(`Zapisano tekst z ${saved} dokumentów — porządkuję`, `Saved text from ${saved} documents — organising`)); void analyzeAll(); }
  }
  const pick = (fl: FileList | null) => run([...(fl ?? [])].map((f) => ({ file: f, path: ((f as any).webkitRelativePath ?? '').split('/').slice(0, -1).join('/') })));
</script>

<div>
  <button class="drop w-full" class:on={drag} onclick={() => input.click()} disabled={busy}
    ondragover={(e) => { e.preventDefault(); drag = true; }} ondragleave={() => (drag = false)}
    ondrop={async (e) => { e.preventDefault(); drag = false; if (e.dataTransfer) await run(await fromDrop(e.dataTransfer)); }}>
    <div class="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-white/10 muted">
      {#if busy}<span class="spin inline-block h-6 w-6 rounded-full border-2 border-white/20 border-t-white"></span>{:else}<Icon name="upload" size={26} />{/if}
    </div>
    <div class="mt-5 text-[22px] font-medium tracking-[-0.02em]">{tr('Upuść pliki lub cały folder', 'Drop files or a whole folder')}</div>
    <div class="mx-auto mt-1.5 max-w-[620px] text-[14.5px] faint">{tr('PDF, skany, Word, PowerPoint, Excel, CSV, zdjęcia dokumentów, ZIP. Pliki czytane są na tym komputerze — na serwer trafia wyłącznie tekst. Wideo i zwykłe zdjęcia są pomijane.', 'PDF, scans, Word, PowerPoint, Excel, CSV, photos of documents, ZIP. Files are read on this computer — only text goes to the server. Videos and plain photos are skipped.')}</div>
  </button>
  <div class="mt-3 flex flex-wrap gap-2">
    <button class="pill" onclick={() => input.click()} disabled={busy}><Icon name="plus" size={15} />{tr('Wybierz pliki', 'Choose files')}</button>
    <button class="pill" onclick={() => dirInput.click()} disabled={busy}><Icon name="layers" size={15} />{tr('Wybierz folder', 'Choose a folder')}</button>
    {#if docs.analyzing}<span class="pill"><span class="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-white/20 border-t-white"></span>{tr('AI porządkuje dokumenty', 'AI is organising documents')}{docs.progress ? ` · ${docs.progress}` : ''}</span>{/if}
    {#if done && !busy}<button class="pill pill-accent ml-auto" onclick={() => go('/')}>{tr('Zobacz dokumenty', 'View documents')}<Icon name="right" size={14} /></button>{/if}
  </div>
  <input bind:this={input} type="file" multiple class="hidden" onchange={(e) => { void pick((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }} />
  <input bind:this={dirInput} type="file" multiple webkitdirectory class="hidden" onchange={(e) => { void pick((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }} />

  {#if items.length}
    <div class="mt-5 flex items-center justify-between text-[14px]">
      <span class="muted">{done} {tr('zapisanych', 'saved')} · {skipped} {tr('pominiętych', 'skipped')} · {items.length} {tr('razem', 'total')}</span>
      {#if !busy}<button class="pill pill-sm" onclick={() => (items = [])}>{tr('Wyczyść listę', 'Clear list')}</button>{/if}
    </div>
    <div class="mt-2 max-h-[420px] space-y-1.5 overflow-y-auto">
      {#each items as it, i (i)}
        <div class="flex items-center gap-3 rounded-xl bg-white/[0.025] px-4 py-2.5 text-[14px]">
          <span class="shrink-0" style="color:{it.state === 'ok' ? '#34d399' : it.state === 'err' ? '#f04438' : '#71717a'}">
            {#if it.state === 'read'}<span class="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-white/20 border-t-white"></span>
            {:else}<Icon name={it.state === 'ok' ? 'check' : it.state === 'wait' ? 'report' : it.state === 'skip' ? 'x' : 'alert'} size={15} />{/if}
          </span>
          <span class="min-w-0 flex-1 truncate" class:faint={it.state === 'skip'}>{it.name}</span>
          <span class="max-w-[45%] shrink-0 truncate text-[13px] faint">{it.note}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .drop { border: 1px dashed rgb(255 255 255 / 0.18); border-radius: 20px; padding: 52px 24px; text-align: center; transition: background .3s, border-color .3s; }
  .drop:hover, .drop.on { background: rgb(255 255 255 / 0.03); border-color: rgb(255 255 255 / 0.4); }
</style>
