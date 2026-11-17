<script lang="ts">
  import { active, app, loadLocations, toast } from '../lib/stores/app.svelte';
  import { rolesOf } from '../lib/data/api';
  import { load } from '../lib/data/load.svelte';
  import { locationStats, withDirectory } from '../lib/data/locs';
  import { toPoints } from '../lib/data/geo';
  import { geocodeAll } from '../lib/data/geocode';
  import { t, tr } from '../lib/i18n.svelte';
  import { href } from '../lib/router.svelte';
  import { int } from '../lib/format';
  import PageHeader from '../lib/ui/PageHeader.svelte';
  import Kpi from '../lib/ui/Kpi.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Empty from '../lib/ui/Empty.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import MapView from '../lib/map/MapView.svelte';

  const ds = $derived(active());
  const R = $derived(ds ? rolesOf(ds) : null);
  const s = load(locationStats);
  let colorBy = $state<'margin' | 'value' | 'group'>('margin');
  let fManager = $state('');
  let fKind = $state('');
  let mapRef = $state<MapView>();

  const all = $derived(withDirectory(s.data ?? [], app.locations));
  const rows = $derived(all.filter((x) => (!fManager || x.manager === fManager) && (!fKind || x.kind === fKind)));
  const points = $derived(toPoints(rows, app.locations));
  const managers = $derived([...new Set(all.map((x) => x.manager).filter(Boolean))].sort());
  const kinds = $derived([...new Set(all.map((x) => x.kind).filter((k) => k && k !== '—'))]);
  const missing = $derived(app.locations.filter((l) => l.status === 'pending' || l.status === 'failed').length);
  const regions = $derived(new Set(app.locations.map((l) => l.region).filter(Boolean)).size);
  const cities = $derived(new Set(app.locations.map((l) => l.city).filter(Boolean)).size);

  let geocoding = $state(false);
  let geoInfo = $state('');
  async function geocode() {
    geocoding = true;
    try {
      let n = 0;
      await geocodeAll(loadLocations, (left) => { geoInfo = `${left} ${tr('pozostało', 'left')}`; if (++n % 8 === 0) void loadLocations(); });
    } catch (e) { console.error('geocode', e); toast(e instanceof Error ? e.message : String(e), 'err'); }
    geocoding = false; geoInfo = '';
  }
</script>

{#if !ds}<Empty />
{:else if !R?.has('location')}<Empty role="location / magazyn / sklep" />
{:else}
  <PageHeader title={t('map.title')} sub={t('map.sub')}>
    {#if missing}
      <button class="pill" data-group="products" onclick={geocode} disabled={geocoding}>
        {#if geocoding}<span class="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-white/20 border-t-white"></span>{geoInfo || t('map.geocoding')}{:else}<Icon name="pin" size={15} />{t('map.geocode')} · {missing} {t('map.missing')}{/if}
      </button>
    {/if}
  </PageHeader>

  <div class="kpis">
    <Kpi i={0} label={t('kpi.locations')} value={all.length || null} format="int" compact={false} icon="store" group="locations" loading={s.loading} hint="{int(points.length)} {tr('ze współrzędnymi', 'with coordinates')}" />
    <Kpi i={1} label={t('kpi.cities')} value={cities || null} format="int" compact={false} icon="pin" group="locations" />
    <Kpi i={2} label={t('kpi.regions')} value={regions || null} format="int" compact={false} icon="map" group="managers" />
    <Kpi i={3} label={tr('Zasięg', 'Coverage')} value={points.length && all.length ? points.length / all.length : null} format="pct" icon="globe" group="finance" hint={tr('punktów na mapie', 'points mapped')} />
  </div>

  <Panel class="mt-4" title={tr('Interaktywna mapa', 'Interactive map')} sub={tr('Kliknij punkt, aby zobaczyć szczegóły · przewiń, aby przybliżyć', 'Click a point for details · scroll to zoom')} icon="map" group="locations" i={1}>
    {#snippet actions()}
      <div class="hidden flex-wrap gap-2 md:flex">
        <select class="input !h-9 !w-auto !text-[13.5px]" bind:value={colorBy}>
          <option value="margin">{t('map.color')}: {t('kpi.margin')}</option>
          <option value="value">{t('map.color')}: {t('kpi.revenue')}</option>
          <option value="group">{t('map.color')}: —</option>
        </select>
        {#if managers.length}<select class="input !h-9 !w-auto !text-[13.5px]" bind:value={fManager}><option value="">{t('loc.manager')}: {t('common.all')}</option>{#each managers as m}<option>{m}</option>{/each}</select>{/if}
        {#if kinds.length}<select class="input !h-9 !w-auto !text-[13.5px]" bind:value={fKind}><option value="">{tr('Rodzaj', 'Type')}: {t('common.all')}</option>{#each kinds as k}<option>{k}</option>{/each}</select>{/if}
      </div>
    {/snippet}
    <MapView bind:this={mapRef} {points} height="min(68vh, 720px)" colorScale={colorBy} detailHref={(c) => href(`/locations/${encodeURIComponent(c)}`)} />
    {#if colorBy === 'margin'}
      <div class="mt-3 flex flex-wrap items-center gap-4 text-[13px] faint">
        <span>{t('kpi.margin')}:</span>
        {#each [['#f04438', tr('ujemna', 'negative')], ['#ff6a3d', tr('niska', 'low')], ['#e4e4e7', tr('średnia', 'average')], ['#34d399', tr('wysoka', 'high')]] as [c, l]}<span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full" style="background:{c}"></span>{l}</span>{/each}
        <span class="ml-auto">{tr('Wielkość = przychód', 'Size = revenue')}</span>
      </div>
    {/if}
  </Panel>

  <Panel class="mt-4" title={t('loc.top')} icon="trendUp" group="locations" i={2}>
    <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {#each rows.slice(0, 12) as x, i (x.loc)}
        <button class="flex items-center gap-3 rounded-2xl bg-white/[0.025] px-4 py-3 text-left transition hover:bg-white/[0.05] rise" style="--i:{i}" onclick={() => mapRef?.flyTo(x.loc)}>
          <span class="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#ff6a3d]/15 text-[13px] font-semibold text-[#ff6a3d]">{i + 1}</span>
          <span class="min-w-0"><span class="block truncate text-[14px] font-bold">{x.loc}</span><span class="block truncate text-[12.5px] faint">{x.city} · {x.manager ?? ''}</span></span>
        </button>
      {/each}
    </div>
  </Panel>
{/if}
