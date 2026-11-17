<script lang="ts">
  import { app } from '../lib/stores/app.svelte';
  import { t, tr } from '../lib/i18n.svelte';
  import { int } from '../lib/format';
  import PageHeader from '../lib/ui/PageHeader.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Upload from '../lib/sources/Upload.svelte';
  import Datasets from '../lib/sources/Datasets.svelte';
  import Connectors from '../lib/sources/Connectors.svelte';
  import LocationsEditor from '../lib/sources/LocationsEditor.svelte';

  let tab = $state<'upload' | 'datasets' | 'connectors' | 'locations'>(app.datasets.length ? 'datasets' : 'upload');
  const tabs = $derived([
    { k: 'upload', l: t('src.upload'), n: null },
    { k: 'datasets', l: t('src.datasets'), n: app.datasets.length },
    { k: 'connectors', l: t('src.connectors'), n: null },
    { k: 'locations', l: t('src.locations'), n: app.locations.length },
  ] as const);
</script>

<PageHeader title={t('src.title')} sub={t('src.sub')} />

<div class="mb-5 flex flex-wrap gap-2 rise" style="--i:1" data-group="locations">
  {#each tabs as x}
    <button class="pill" class:pill-accent={tab === x.k} onclick={() => (tab = x.k)}>{x.l}{#if x.n}<span class="rounded-full bg-black/20 px-1.5 text-[12.5px]">{int(x.n)}</span>{/if}</button>
  {/each}
</div>

{#key tab}
  {#if tab === 'upload'}
    <Panel title={t('src.upload')} sub={tr('Każdy plik staje się tabelą do analizy — system sam rozpoznaje kolumny, typy i role. Słownik punktów (adresy) aktualizuje mapę.', 'Every file becomes an analysable table — the system detects columns, types and roles. A point directory (addresses) updates the map.')} icon="upload" group="locations">
      <Upload />
    </Panel>
  {:else if tab === 'datasets'}
    <Datasets />
  {:else if tab === 'connectors'}
    <Panel title={t('src.connectors')} sub={tr('POS, ERP, API, bazy danych, otwarte dane — synchronizacja ręczna lub cykliczna', 'POS, ERP, APIs, databases, open data — manual or scheduled sync')} icon="link" group="ai">
      <Connectors />
    </Panel>
  {:else}
    <Panel title={t('src.locations')} sub={tr('Słownik punktów: adresy, współrzędne, województwa', 'Point directory: addresses, coordinates, regions')} icon="pin" group="locations">
      <LocationsEditor />
    </Panel>
  {/if}
{/key}
