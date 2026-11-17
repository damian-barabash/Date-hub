<script lang="ts">
  // Число «набегает» от 0 до значения (easeOutExpo), повторно — плавно от прошлого значения.
  import { fmt, type Fmt } from '../format';
  let { value = 0, format = 'num', compact = true, duration = 1400 }: { value: number | null; format?: Fmt; compact?: boolean; duration?: number } = $props();
  let shown = $state(0);
  let from = 0;
  $effect(() => {
    const to = value ?? 0;
    const start = performance.now(); const f0 = from;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const e = k === 1 ? 1 : 1 - Math.pow(2, -10 * k);
      shown = f0 + (to - f0) * e;
      if (k < 1) raf = requestAnimationFrame(tick); else from = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });
</script>

<span class="num">{value === null ? '—' : fmt(format === 'int' ? Math.round(shown) : shown, format, compact)}</span>
