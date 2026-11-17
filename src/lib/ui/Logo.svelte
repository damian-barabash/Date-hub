<script lang="ts">
  import { CUTS, D_SHAPE } from './logo-paths';
  let { size = 34, text = true, sub = true, color = 'currentColor', gradient = false, animate = false }:
    { size?: number; text?: boolean; sub?: boolean; color?: string; gradient?: boolean; animate?: boolean } = $props();
  const uid = Math.random().toString(36).slice(2, 8);
</script>

<div class="flex items-center gap-3 select-none" style="color:{color}">
  <svg width={size * 1.28} height={size} viewBox="0 0 460 360" aria-hidden="true" class:logo-anim={animate}>
    <defs>
      <mask id="m-{uid}" maskUnits="userSpaceOnUse" x="0" y="0" width="460" height="360">
        <rect width="460" height="360" fill="#000" />
        <path d={D_SHAPE} fill="#fff" />
        {#each CUTS as c}<path d={c} fill="#000" />{/each}
      </mask>
    </defs>
    {#if animate}
      <path d={D_SHAPE} fill="none" stroke="currentColor" stroke-width="6" class="outline" pathLength="1" />
    {/if}
    <rect width="460" height="360" fill="currentColor" mask="url(#m-{uid})" class="fill" />
  </svg>
  {#if text}
    <div class="leading-none">
      <div class="brand text-[15px] font-normal whitespace-nowrap" style="letter-spacing:.06em">AI DATA HUB</div>
      {#if sub}<div class="brand mt-1.5 text-[8.5px] opacity-55 whitespace-nowrap" style="letter-spacing:.55em">CK COMPLEX</div>{/if}
    </div>
  {/if}
</div>

<style>
  .logo-anim .outline { stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw 1.4s cubic-bezier(.65,0,.35,1) forwards; }
  .logo-anim .fill { opacity: 0; animation: logo-fill .9s .9s ease forwards; }
  @keyframes logo-fill { to { opacity: 1; } }
</style>
