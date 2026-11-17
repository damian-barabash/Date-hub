<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { app, boot } from './lib/stores/app.svelte';
  import { route } from './lib/router.svelte';
  import Login from './pages/Login.svelte';
  import Shell from './Shell.svelte';
  import Logo from './lib/ui/Logo.svelte';

  onMount(boot);
</script>

{#if !app.ready}
  <div class="boot" out:fade={{ duration: 250 }}>
    <div class="text-white"><Logo size={38} /></div>
    <div class="boot-bar"><i></i></div>
  </div>
{:else if !app.session}
  <Login />
{:else}
  {#key !!app.session}
    <Shell path={route.path} />
  {/key}
{/if}

{#if app.toast}
  {#key app.toast.id}
    <div class="fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 rise" data-group={app.toast.tone === 'err' ? 'alerts' : app.toast.tone === 'ok' ? 'finance' : 'ai'}>
      <div class="flex items-center gap-3 rounded-full border border-white/10 bg-[#1b1b1e]/95 px-5 py-3 text-sm font-semibold shadow-2xl backdrop-blur">
        {app.toast.text}
      </div>
    </div>
  {/key}
{/if}
