<script lang="ts">
  import { slide, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { app, loadChats, logout, toast } from '../stores/app.svelte';
  import { route, href, go } from '../router.svelte';
  import { t, type Key } from '../i18n.svelte';
  import { supabase } from '../supabase';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';

  /** Удаление строки: уезжает влево, гаснет и схлопывается по высоте. */
  function removeRow(node: HTMLElement, { duration = 320 } = {}) {
    const h = node.offsetHeight;
    return {
      duration, easing: cubicOut,
      css: (t: number) => `opacity:${t}; transform:translateX(${(1 - t) * -18}px); height:${t * h}px; padding-top:${t * 7}px; padding-bottom:${t * 7}px; overflow:hidden;`,
    };
  }

  type Item = { key: Key; path: string; icon: string; group: string; children?: { key: Key; path: string }[] };
  const analytics: Item[] = [
    { key: 'nav.overview', path: '/', icon: 'grid', group: 'ai' },
    { key: 'nav.managers', path: '/managers', icon: 'users', group: 'managers', children: [
      { key: 'nav.managers.all', path: '/managers' }, { key: 'nav.managers.compare', path: '/managers/compare' } ] },
    { key: 'nav.locations', path: '/locations', icon: 'store', group: 'locations', children: [
      { key: 'nav.locations.all', path: '/locations' }, { key: 'nav.locations.region', path: '/locations/region' }, { key: 'nav.map', path: '/map' } ] },
    { key: 'nav.products', path: '/products', icon: 'box', group: 'products' },
    { key: 'nav.finance', path: '/finance', icon: 'wallet', group: 'finance', children: [
      { key: 'nav.finance.revenue', path: '/finance' }, { key: 'nav.finance.margin', path: '/finance/margin' }, { key: 'nav.finance.prices', path: '/finance/prices' } ] },
    { key: 'nav.reports', path: '/reports', icon: 'report', group: 'ai' },
    { key: 'nav.explore', path: '/explore', icon: 'compass', group: 'ai' },
  ];

  const isOn = (p: string) => (p === '/' ? route.path === '/' : route.path === p || route.path.startsWith(p + '/'));
  const groupOn = (it: Item) => isOn(it.path) || !!it.children?.some((c) => isOn(c.path)) || (it.path === '/locations' && route.path === '/map');
  let open = $state<Record<string, boolean>>({});
  let chatsOpen = $state(true);

  const buckets = $derived.by(() => {
    const now = new Date(); const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const out: { label: Key; items: typeof app.chats }[] = [
      { label: 'common.today', items: [] }, { label: 'common.yesterday', items: [] }, { label: 'common.older', items: [] }];
    for (const c of app.chats) {
      const ts = new Date(c.updated_at).getTime();
      out[ts >= d0 ? 0 : ts >= d0 - 864e5 ? 1 : 2].items.push(c);
    }
    return out.filter((b) => b.items.length);
  });

  async function delChat(id: string, e: Event) {
    e.preventDefault(); e.stopPropagation();
    // сразу убираем из списка (строка плавно схлопывается), затем удаляем в базе
    const before = app.chats;
    app.chats = app.chats.filter((c) => c.id !== id);
    if (route.path === `/chat/${id}`) go('/chat');
    const { error } = await supabase.from('chats').delete().eq('id', id);
    if (error) { app.chats = before; toast(error.message, 'err'); }
  }
  async function delAll() {
    if (!confirm(t('common.confirm'))) return;
    const ids = app.chats.map((c) => c.id);
    app.chats = []; go('/chat');
    if (ids.length) await supabase.from('chats').delete().in('id', ids);
    await loadChats();
  }
  const user = $derived(app.session?.user?.user_metadata?.username ?? app.session?.user?.email?.split('@')[0] ?? '');
</script>

{#if app.sidebarOpen}
  <button class="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden" aria-label="close" transition:fade={{ duration: 200 }} onclick={() => (app.sidebarOpen = false)}></button>
{/if}

<aside class="no-print fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col border-r border-white/[0.06] bg-[#0c0c0d] transition-transform duration-500 lg:static lg:translate-x-0"
  class:-translate-x-full={!app.sidebarOpen} class:lg:hidden={app.sidebarCollapsed} style="transition-timing-function: var(--ease-out-expo)">
  <div class="flex h-[68px] items-center justify-between px-5">
    <a href={href('/')} class="text-white"><Logo size={26} /></a>
  </div>

  <nav class="flex-1 overflow-y-auto px-3 pb-4">
    <a href={href('/chat')} class="nav-item" class:active={route.path.startsWith('/chat')}><Icon name="ask" size={17} /><span>{t('nav.chat')}</span></a>

    <div class="mt-5 mb-2 px-3 text-[13px] font-medium faint">{t('nav.analytics')}</div>
    {#each analytics as it (it.key)}
      {@const on = groupOn(it)}
      {@const expanded = open[it.key] ?? on}
      <div data-group={it.group}>
        {#if it.children}
          <button class="nav-item w-full" class:active={on} onclick={() => { open[it.key] = !expanded; if (!on) go(it.path); }}>
            <Icon name={it.icon} size={17} /><span class="truncate">{t(it.key)}</span>
            <span class="ml-auto transition-transform duration-300" class:rotate-180={expanded}><Icon name="chevron" size={15} /></span>
          </button>
          {#if expanded}
            <div class="relative ml-[22px] border-l border-white/[0.08] py-1 pl-3" transition:slide={{ duration: 280 }}>
              {#each it.children as c (c.path)}
                <a href={href(c.path)} class="sub-item" class:active={route.path === c.path}>{t(c.key)}</a>
              {/each}
            </div>
          {/if}
        {:else}
          <a href={href(it.path)} class="nav-item" class:active={on}><Icon name={it.icon} size={17} /><span>{t(it.key)}</span></a>
        {/if}
      </div>
    {/each}

    <div class="mt-6 mb-2 flex items-center justify-between px-3">
      <button class="flex h-8 items-center gap-1.5 text-[13px] font-medium faint hover:text-white" onclick={() => (chatsOpen = !chatsOpen)}>
        {t('nav.discussions')}<span class="transition-transform" class:rotate-180={chatsOpen}><Icon name="chevron" size={13} /></span>
      </button>
      <div class="flex gap-1">
        {#if app.chats.length}<button class="mini" title={t('chat.deleteAll')} onclick={delAll}><Icon name="trash" size={14} /></button>{/if}
        <a class="mini" title={t('nav.newchat')} href={href('/chat')}><Icon name="plus" size={15} /></a>
      </div>
    </div>
    {#if chatsOpen}
      <div transition:slide={{ duration: 250 }}>
        {#each buckets as b (b.label)}
          <div class="mt-2 mb-1 px-3 text-[12.5px] font-semibold faint">{t(b.label)}</div>
          {#each b.items as c (c.id)}
            <a href={href(`/chat/${c.id}`)} class="chat-item group" class:active={route.path === `/chat/${c.id}`}
              in:slide={{ duration: 260 }} out:removeRow={{ duration: 320 }}>
              <span class="truncate">{c.title}</span>
              <button class="-my-1 -mr-2 ml-auto hidden h-8 w-8 shrink-0 place-items-center opacity-60 group-hover:grid hover:opacity-100" aria-label="delete" onclick={(e) => delChat(c.id, e)}><Icon name="x" size={13} /></button>
            </a>
          {/each}
        {/each}
      </div>
    {/if}

    <div class="mt-6 mb-2 px-3 text-[13px] font-medium faint">{t('nav.data')}</div>
    <a href={href('/sources')} class="nav-item" class:active={isOn('/sources')} data-group="locations"><Icon name="database" size={17} /><span>{t('nav.sources')}</span></a>
    <a href={href('/settings')} class="nav-item" class:active={isOn('/settings')} data-group="ai"><Icon name="settings" size={17} /><span>{t('nav.settings')}</span></a>
  </nav>

  <div class="flex items-center gap-3 border-t border-white/[0.06] px-4 py-3.5">
    <div class="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 text-[14px] font-medium uppercase">{user.slice(0, 1)}</div>
    <div class="min-w-0 flex-1">
      <div class="truncate text-[14px] font-bold">{user}</div>
      <div class="text-[12.5px] faint">CK Complex</div>
    </div>
    <button class="icon-btn !h-8 !w-8" title={t('nav.logout')} onclick={logout}><Icon name="logout" size={15} /></button>
  </div>
</aside>

<style>
  .nav-item { display: flex; align-items: center; gap: 11px; height: 40px; padding: 0 12px; border-radius: 12px; font-size: 15px; font-weight: 500; color: var(--color-ink-2); transition: background .25s, color .25s; margin-bottom: 2px; }
  .nav-item:hover { background: rgb(255 255 255 / 0.04); color: var(--color-ink); }
  .nav-item.active { color: var(--color-ink); background: rgb(255 255 255 / 0.07); }
  .sub-item { display: block; position: relative; padding: 7px 10px; border-radius: 10px; font-size: 14.5px; font-weight: 500; color: var(--color-ink-3); transition: color .2s, background .2s; }
  .sub-item:hover { color: var(--color-ink); }
  .sub-item.active { color: var(--color-ink); }
  .sub-item.active::before { content: ''; position: absolute; left: -13px; top: 8px; bottom: 8px; width: 1px; background: var(--color-accent); }
  .chat-item { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 10px; font-size: 14.5px; color: var(--color-ink-2); transition: background .2s, color .2s; }
  .chat-item:hover { background: rgb(255 255 255 / 0.04); color: var(--color-ink); }
  .chat-item.active { background: rgb(255 255 255 / 0.07); color: var(--color-ink); }
  .mini { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 8px; color: var(--color-ink-3); transition: background .2s, color .2s; }
  .mini:hover { background: rgb(255 255 255 / 0.06); color: var(--color-ink); }
</style>
