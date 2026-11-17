<script lang="ts">
  import { fly } from 'svelte/transition';
  import { app, active, loadDatasets } from '../stores/app.svelte';
  import { i18n, setLang, t } from '../i18n.svelte';
  import { href, route } from '../router.svelte';
  import { supabase } from '../supabase';
  import { clearCache } from '../data/api';
  import { int } from '../format';
  import Icon from './Icon.svelte';

  let menu = $state(false);
  const ds = $derived(active());
  const ready = $derived(app.datasets.filter((d) => d.status === 'ready'));

  async function pick(id: string) {
    menu = false;
    await supabase.rpc('ds_set_active', { p_id: id });
    clearCache();
    await loadDatasets();
  }
  function toggleSidebar() {
    if (window.innerWidth >= 1024) app.sidebarCollapsed = !app.sidebarCollapsed;
    else app.sidebarOpen = !app.sidebarOpen;
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') menu = false; }} />

<header class="no-print flex h-[68px] shrink-0 items-center gap-3 border-b border-white/[0.06] bg-[#0a0a0b]/80 px-4 backdrop-blur-xl md:px-6">
  <button class="icon-btn" aria-label="menu" onclick={toggleSidebar}><Icon name="sidebar" size={17} /></button>

  <div class="relative min-w-0">
    {#if ds}
      <button class="pill max-w-[60vw] md:max-w-none" onclick={() => (menu = !menu)} data-group="finance">
        <span class="faint"><Icon name="database" size={15} /></span>
        <span class="truncate">{ds.name}</span>
        {#if ds.meta?.period}<span class="hidden faint sm:inline">{ds.meta.period}</span>{/if}
        <span class="hidden faint md:inline">· {int(ds.row_count)} {t('common.rows')}</span>
        <Icon name="chevron" size={14} />
      </button>
    {:else}
      <a class="pill" href={href('/sources')} data-group="ai"><Icon name="upload" size={15} />{t('empty.cta')}</a>
    {/if}
    {#if menu}
      <button class="fixed inset-0 z-40 cursor-default" aria-label="close" onclick={() => (menu = false)}></button>
      <div class="absolute top-12 left-0 z-50 w-[340px] rounded-2xl border border-white/10 bg-[#151517]/98 p-2 shadow-2xl backdrop-blur-xl" transition:fly={{ y: -6, duration: 220 }}>
        <div class="px-3 pt-2 pb-1 text-[11px] font-bold tracking-widest uppercase faint">{t('src.datasets')}</div>
        {#each ready as d (d.id)}
          <button class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/5" onclick={() => pick(d.id)}>
            <span class="grid h-8 w-8 place-items-center rounded-lg bg-white/5"><Icon name={d.source === 'file' ? 'layers' : 'link'} size={15} /></span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[13px] font-bold">{d.name}</span>
              <span class="block text-[11.5px] faint">{d.meta?.period ?? ''} · {int(d.row_count)} {t('common.rows')}</span>
            </span>
            {#if d.is_active}<span data-group="finance"><span class="badge">{t('src.active')}</span></span>{/if}
          </button>
        {/each}
        <a href={href('/sources')} class="mt-1 flex items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-semibold muted hover:bg-white/5" onclick={() => (menu = false)}>
          <Icon name="plus" size={15} />{t('empty.cta')}
        </a>
      </div>
    {/if}
  </div>

  <div class="ml-auto flex items-center gap-2">
    {#if !route.path.startsWith('/chat')}
      <a class="pill pill-accent hidden sm:inline-flex" data-group="ai" href={href('/chat')}><Icon name="ask" size={15} />{t('ov.ask')}</a>
    {/if}
    <div class="flex rounded-full border border-white/10 bg-[#151517] p-1 text-[12px] font-bold">
      {#each ['pl', 'en'] as l}
        <button class="rounded-full px-3 py-1.5 uppercase transition-colors" class:bg-white={i18n.lang === l} class:text-black={i18n.lang === l}
          class:faint={i18n.lang !== l} onclick={() => setLang(l as 'pl' | 'en')}>{l}</button>
      {/each}
    </div>
  </div>
</header>
