<script lang="ts">
  import CountUp from './CountUp.svelte';
  import Icon from './Icon.svelte';
  import type { Fmt } from '../format';
  let { label, value, format = 'num', hint = '', icon = '', group = 'ai', i = 0, compact = true, loading = false, hero = false, text = '' }:
    { label: string; value: number | null; format?: Fmt; hint?: string; icon?: string; group?: string; i?: number; compact?: boolean; loading?: boolean; hero?: boolean; text?: string } = $props();
</script>

<div class="card card-pad kpi rise min-w-0 overflow-hidden" class:hero data-group={group} style="--i:{i}">
  <div class="flex items-center justify-between gap-3">
    <div class="min-w-0 truncate text-[14.5px] muted">{label}</div>
    {#if icon}<span class="shrink-0 faint"><Icon name={icon} size={17} /></span>{/if}
  </div>
  <div class="val mt-3 truncate leading-none font-semibold tracking-[-0.04em]">
    {#if loading}<div class="skeleton h-8 w-28"></div>{:else if text}{text}{:else}<CountUp {value} {format} {compact} />{/if}
  </div>
  {#if hint}<div class="mt-2.5 truncate text-[13.5px] faint">{hint}</div>{/if}
</div>

<style>
  /* размер числа считается от ширины самой карточки → текст не выходит за края */
  .kpi { container-type: inline-size; }
  .val { font-size: clamp(20px, 13.5cqi, 40px); }
  .hero .val { font-size: clamp(30px, 15cqi, 68px); }
</style>
