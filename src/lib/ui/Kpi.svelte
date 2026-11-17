<script lang="ts">
  import CountUp from './CountUp.svelte';
  import Icon from './Icon.svelte';
  import type { Fmt } from '../format';
  let { label, value, format = 'num', hint = '', icon = '', group = 'ai', i = 0, compact = true, loading = false }:
    { label: string; value: number | null; format?: Fmt; hint?: string; icon?: string; group?: string; i?: number; compact?: boolean; loading?: boolean } = $props();
</script>

<div class="card card-pad rise" data-group={group} style="--i:{i}">
  <div class="flex items-center justify-between gap-3">
    <div class="text-[13px] muted">{label}</div>
    {#if icon}<span class="faint"><Icon name={icon} size={17} /></span>{/if}
  </div>
  <div class="mt-3 text-[23px] leading-none font-medium tracking-[-0.04em] whitespace-nowrap sm:text-[38px]">
    {#if loading}<div class="skeleton h-7 w-28"></div>{:else}<CountUp {value} {format} {compact} />{/if}
  </div>
  {#if hint}<div class="mt-2.5 truncate text-[12px] faint">{hint}</div>{/if}
</div>
