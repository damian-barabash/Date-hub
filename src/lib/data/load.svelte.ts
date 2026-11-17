import { active, type Dataset } from '../stores/app.svelte';

/** Реактивная загрузка данных страницы: перезапускается при смене активного набора. */
export function load<T>(fn: (d: Dataset) => Promise<T>) {
  const s = $state({ data: null as T | null, loading: true, error: '' });
  $effect(() => {
    const d = active();
    if (!d) { s.loading = false; return; }
    let alive = true;
    s.loading = true; s.error = '';
    fn(d).then((v) => { if (alive) { s.data = v; s.loading = false; } })
      .catch((e) => { if (alive) { s.error = e?.message ?? String(e); s.loading = false; console.error(e); } });
    return () => { alive = false; };
  });
  return s;
}
