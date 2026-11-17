<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  let { title = '', sub = '', icon = '', group = 'ai', i = 0, class: cls = '', actions, children }:
    { title?: string; sub?: string; icon?: string; group?: string; i?: number; class?: string; actions?: Snippet; children: Snippet } = $props();
</script>

<section class="card card-pad rise min-w-0 {cls}" data-group={group} style="--i:{i}">
  {#if title}
    <header class="mb-4 flex items-start justify-between gap-3">
      <div class="flex min-w-0 items-start gap-2.5">
        {#if icon}<span class="mt-0.5 faint"><Icon name={icon} size={17} /></span>{/if}
        <div class="min-w-0">
          <h3 class="card-title truncate">{title}</h3>
          {#if sub}<p class="card-sub">{sub}</p>{/if}
        </div>
      </div>
      {#if actions}<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>{/if}
    </header>
  {/if}
  {@render children()}
</section>
