<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, sub = '', children }: { title: string; sub?: string; children?: Snippet } = $props();
</script>

<div class="mb-8 flex flex-wrap items-end justify-between gap-4 rise">
  <div class="min-w-0">
    <h1 class="break-words text-[40px] leading-[1] font-medium tracking-[-0.045em] md:text-[60px]">{title}</h1>
    {#if sub}<p class="mt-3 text-[15px] muted">{sub}</p>{/if}
  </div>
  {#if children}<div class="flex max-w-full min-w-0 flex-wrap items-center gap-2">{@render children()}</div>{/if}
</div>
