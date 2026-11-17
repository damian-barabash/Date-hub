<script lang="ts">
  // Универсальный ECharts-компонент: инициализация, когда график попадает в зону видимости
  // (анимация появления проигрывается на глазах), авто-resize, ленивый 3D.
  import { onDestroy, onMount } from 'svelte';
  import { echarts, ensureGL } from './echarts';
  import { buildOption, GL_KINDS, type ChartSpec } from './spec';

  let {
    spec = null,
    rows = [],
    option = null,
    height = 300,
    onclick = undefined,
  }: {
    spec?: ChartSpec | null;
    rows?: Record<string, any>[];
    option?: Record<string, any> | null;
    height?: number | string;
    onclick?: (p: any) => void;
  } = $props();

  let el: HTMLDivElement;
  let chart: echarts.ECharts | null = null;
  let visible = $state(false);
  let failed = $state('');
  let ro: ResizeObserver | null = null;
  let io: IntersectionObserver | null = null;

  const gl = $derived(!!spec && GL_KINDS.includes(spec.chart));
  const opt = $derived.by(() => {
    try { return option ?? (spec ? buildOption(spec, rows) : null); } catch (e) { console.error(e); return null; }
  });

  async function render(o: Record<string, any> | null) {
    if (!o || !el) return;
    try {
      if (gl) await ensureGL();
      if (!chart) {
        chart = echarts.init(el, null, { renderer: 'canvas' });
        chart.on('click', (p) => onclick?.(p));
      }
      chart.setOption(o, { notMerge: true, lazyUpdate: true });
    } catch (e) {
      failed = e instanceof Error ? e.message : String(e);
    }
  }

  onMount(() => {
    io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { visible = true; io?.disconnect(); }
    }, { rootMargin: '80px' });
    io.observe(el);
    let rt = 0;
    ro = new ResizeObserver(() => { clearTimeout(rt); rt = window.setTimeout(() => chart?.resize({ animation: { duration: 350, easing: 'cubicOut' } }), 90); });
    ro.observe(el);
  });

  $effect(() => {
    if (visible) void render(opt);
  });

  onDestroy(() => {
    io?.disconnect();
    ro?.disconnect();
    chart?.dispose();
    chart = null;
  });
</script>

<div class="relative w-full" style="height:{typeof height === 'number' ? `${height}px` : height}">
  <div bind:this={el} class="absolute inset-0"></div>
  {#if !visible}
    <div class="skeleton absolute inset-2 opacity-60"></div>
  {/if}
  {#if failed}
    <div class="absolute inset-0 grid place-items-center text-sm faint">{failed}</div>
  {/if}
</div>
