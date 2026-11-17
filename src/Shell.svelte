<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Sidebar from './lib/ui/Sidebar.svelte';
  import Topbar from './lib/ui/Topbar.svelte';
  import { app } from './lib/stores/app.svelte';
  import { route } from './lib/router.svelte';

  let { path }: { path: string } = $props();

  // ленивые страницы — каждая в своём чанке
  const pages: [RegExp, () => Promise<any>][] = [
    [/^\/$/, () => import('./pages/Overview.svelte')],
    [/^\/chat(\/[\w-]+)?$/, () => import('./pages/Chat.svelte')],
    [/^\/managers\/compare$/, () => import('./pages/ManagersCompare.svelte')],
    [/^\/managers(\/.+)?$/, () => import('./pages/Managers.svelte')],
    [/^\/locations\/region$/, () => import('./pages/Regions.svelte')],
    [/^\/locations\/.+$/, () => import('./pages/LocationDetail.svelte')],
    [/^\/locations$/, () => import('./pages/Locations.svelte')],
    [/^\/map$/, () => import('./pages/MapPage.svelte')],
    [/^\/products$/, () => import('./pages/Products.svelte')],
    [/^\/finance\/margin$/, () => import('./pages/Margin.svelte')],
    [/^\/finance\/prices$/, () => import('./pages/Prices.svelte')],
    [/^\/finance$/, () => import('./pages/Finance.svelte')],
    [/^\/reports(\/[\w-]+)?$/, () => import('./pages/Reports.svelte')],
    [/^\/explore$/, () => import('./pages/Explorer.svelte')],
    [/^\/sources$/, () => import('./pages/Sources.svelte')],
    [/^\/settings$/, () => import('./pages/Settings.svelte')],
  ];
  const loader = $derived((pages.find(([re]) => re.test(path)) ?? pages[0])[1]);
  // ключ страницы: чат с разными id — одна страница (без перемонтирования)
  const pageKey = $derived(path.startsWith('/chat') ? '/chat' : path);
  let main: HTMLElement;
  $effect(() => { void pageKey; main?.scrollTo({ top: 0 }); app.sidebarOpen = false; });
</script>

<div class="flex h-full">
  <Sidebar />
  <div class="flex min-w-0 flex-1 flex-col">
    <Topbar />
    <main bind:this={main} class="print-area relative flex-1 overflow-y-auto overflow-x-hidden" style="scrollbar-gutter: stable">
      {#key pageKey}
        <div class="mx-auto w-full max-w-[1480px] px-4 pb-16 pt-6 md:px-8" in:fly={{ y: 12, duration: 450, easing: cubicOut }}>
          {#await loader() then mod}
            <mod.default {route} />
          {/await}
        </div>
      {/key}
    </main>
  </div>
</div>
