<script lang="ts">
  // Markdown ответа ИИ с «проявлением» по словам (blur → резкость), безопасно (DOMPurify).
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  let { text = '', animate = false }: { text: string; animate?: boolean } = $props();
  const html = $derived.by(() => {
    const raw = DOMPurify.sanitize(marked.parse(text ?? '', { async: false, breaks: true }) as string);
    if (!animate) return raw;
    // оборачиваем слова в span с задержкой — только в текстовых узлах
    let i = 0;
    return raw.replace(/>([^<]+)</g, (_m, txt: string) => '>' + txt.replace(/(\S+)/g, (w) => `<span class="w" style="animation-delay:${Math.min(i++ * 18, 2600)}ms">${w}</span>`) + '<');
  });
</script>

<div class="md" class:anim={animate}>{@html html}</div>

<style>
  .anim :global(.w) { display: inline-block; animation: word .5s cubic-bezier(.16,1,.3,1) both; }
</style>
