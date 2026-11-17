<script lang="ts">
  import { supabase } from '../supabase';
  import { geocodeAll } from '../data/geocode';
  import { app, loadLocations, toast, type Location } from '../stores/app.svelte';
  import { t, tr } from '../i18n.svelte';
  import { int } from '../format';
  import Icon from '../ui/Icon.svelte';

  let q = $state('');
  let status = $state('');
  let edit = $state<Location | null>(null);
  let busy = $state(false);
  let info = $state('');

  const counts = $derived(app.locations.reduce((a, l) => ((a[l.status] = (a[l.status] ?? 0) + 1), a), {} as Record<string, number>));
  const list = $derived(app.locations.filter((l) => (!status || l.status === status) && (!q || `${l.code} ${l.name ?? ''} ${l.city ?? ''} ${l.street ?? ''}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 300));
  const TONE: Record<string, string> = { ok: 'finance', approx: 'products', failed: 'alerts', pending: 'ai', manual: 'managers' };

  async function geocode() {
    busy = true;
    try {
      let n = 0;
      await geocodeAll(loadLocations, (left) => { info = `${left} ${tr('pozostało', 'left')}`; if (++n % 8 === 0) void loadLocations(); });
      toast('OK');
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'err'); }
    busy = false; info = '';
  }
  async function retryFailed() {
    await supabase.from('locations').update({ status: 'pending' }).in('status', ['failed', 'approx']);
    await loadLocations(); void geocode();
  }
  async function save() {
    if (!edit) return;
    const e = edit;
    const manualCoords = e.lat !== null && e.lng !== null && String(e.lat) !== '' && String(e.lng) !== '';
    const { error } = await supabase.from('locations').update({
      name: e.name, city: e.city, street: e.street, region: e.region, postal: e.postal,
      lat: manualCoords ? Number(e.lat) : null, lng: manualCoords ? Number(e.lng) : null,
      status: manualCoords ? 'manual' : 'pending', updated_at: new Date().toISOString(),
    }).eq('code', e.code);
    if (error) return toast(error.message, 'err');
    edit = null; await loadLocations(); toast('OK');
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') edit = null; }} />

<div data-group="locations">
  <div class="mb-4 flex flex-wrap items-center gap-2">
    {#each Object.entries(counts) as [k, v]}
      <button class="pill pill-sm" data-group={TONE[k] ?? 'ai'} class:pill-accent={status === k} onclick={() => (status = status === k ? '' : k)}>{k} · {int(v)}</button>
    {/each}
    <div class="ml-auto flex gap-2">
      {#if counts.failed || counts.approx}<button class="pill pill-sm" onclick={retryFailed} disabled={busy}><Icon name="refresh" size={13} />{tr('Ponów nieudane', 'Retry failed')}</button>{/if}
      {#if counts.pending}<button class="pill pill-sm pill-accent" onclick={geocode} disabled={busy}>{#if busy}<span class="spin inline-block h-3 w-3 rounded-full border-2 border-black/20 border-t-black"></span>{info}{:else}<Icon name="pin" size={13} />{t('map.geocode')} ({counts.pending}){/if}</button>{/if}
    </div>
  </div>
  <div class="relative mb-3">
    <span class="absolute top-1/2 left-3.5 -translate-y-1/2 faint"><Icon name="search" size={15} /></span>
    <input class="input !pl-10" placeholder={t('common.search')} bind:value={q} />
  </div>
  <div class="max-h-[560px] overflow-auto">
    <table class="table">
      <thead><tr><th>{t('loc.code')}</th><th>{tr('Nazwa', 'Name')}</th><th>{t('loc.address')}</th><th>{t('loc.region')}</th><th>{tr('Status', 'Status')}</th><th></th></tr></thead>
      <tbody>
        {#each list as l (l.code)}
          <tr>
            <td class="font-bold">{l.code}</td>
            <td class="max-w-[200px] truncate muted">{l.name ?? '—'}</td>
            <td class="max-w-[260px] truncate">{[l.street, l.postal, l.city].filter(Boolean).join(', ') || '—'}</td>
            <td class="muted">{l.region ?? '—'}</td>
            <td><span data-group={TONE[l.status] ?? 'ai'}><span class="badge">{l.status}</span></span></td>
            <td class="r"><button class="icon-btn !h-8 !w-8" onclick={() => (edit = { ...l })} aria-label="edit"><Icon name="settings" size={14} /></button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

{#if edit}
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="presentation" onclick={(e) => e.target === e.currentTarget && (edit = null)}>
    <div class="card w-full max-w-lg p-6 rise" data-group="locations">
      <div class="mb-4 text-[18px] font-semibold">{edit.code}</div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="sm:col-span-2"><label class="label" for="ln">{tr('Nazwa', 'Name')}</label><input id="ln" class="input" bind:value={edit.name} /></div>
        <div><label class="label" for="lc">{t('loc.city')}</label><input id="lc" class="input" bind:value={edit.city} /></div>
        <div><label class="label" for="lp">{tr('Kod pocztowy', 'Postal code')}</label><input id="lp" class="input" bind:value={edit.postal} /></div>
        <div class="sm:col-span-2"><label class="label" for="ls">{t('loc.address')}</label><input id="ls" class="input" bind:value={edit.street} /></div>
        <div><label class="label" for="llat">Lat</label><input id="llat" class="input" bind:value={edit.lat} placeholder="52.23" /></div>
        <div><label class="label" for="llng">Lng</label><input id="llng" class="input" bind:value={edit.lng} placeholder="21.01" /></div>
      </div>
      <p class="mt-3 text-[12px] faint">{tr('Puste współrzędne → punkt zostanie zgeokodowany ponownie z adresu.', 'Empty coordinates → the point will be re-geocoded from the address.')}</p>
      <div class="mt-5 flex gap-2"><button class="pill pill-accent" onclick={save}>{t('common.save')}</button><button class="pill" onclick={() => (edit = null)}>{t('common.cancel')}</button></div>
    </div>
  </div>
{/if}
