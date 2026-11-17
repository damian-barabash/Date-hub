<script lang="ts">
  import { tick } from 'svelte';
  import { fly, slide } from 'svelte/transition';
  import { active, app, loadChats, toast } from '../lib/stores/app.svelte';
  import { askAI } from '../lib/chat/sse';
  import { supabase } from '../lib/supabase';
  import { i18n, t, tr } from '../lib/i18n.svelte';
  import { go, href, route } from '../lib/router.svelte';
  import { int } from '../lib/format';
  import { agg, rolesOf } from '../lib/data/api';
  import Blocks from '../lib/chat/Blocks.svelte';
  import Markdown from '../lib/chat/Markdown.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Logo from '../lib/ui/Logo.svelte';
  import CountUp from '../lib/ui/CountUp.svelte';

  type Step = { key: string; label: string; done: boolean; error?: boolean };
  type Msg = { id?: string; role: 'user' | 'assistant'; content: any; usage?: any; fresh?: boolean; pending?: boolean; steps?: Step[]; error?: string; shown?: number; built?: boolean };

  let messages = $state<Msg[]>([]);
  let input = $state('');
  let busy = $state(false);
  let chatId = $state<string | null>(null);
  let scroller: HTMLDivElement;
  let ta: HTMLTextAreaElement;
  let showSql = $state<Record<number, boolean>>({});
  let ctrl: AbortController | null = null;
  const ds = $derived(active());

  // id из адреса: /chat/<id>
  const routeId = $derived(route.parts[1] ?? null);
  $effect(() => {
    const id = routeId;
    if (id === chatId) return;
    chatId = id;
    if (id) void loadChat(id); else messages = [];
  });
  // /chat?q=… — автоотправка вопроса (из дашбордов)
  $effect(() => {
    const q = route.query.get('q');
    if (q && !busy) { history.replaceState(null, '', '#/chat'); route.query = new URLSearchParams(); chatId = null; messages = []; void send(q); }
  });

  async function loadChat(id: string) {
    const { data } = await supabase.from('messages').select('id, role, content, usage, created_at').eq('chat_id', id).order('created_at');
    messages = (data ?? []) as Msg[];
    await tick(); scrollDown(false);
  }

  function scrollDown(smooth = true) { scroller?.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); }

  const stepLabel = (k: string) => (({ context: t('chat.step.context'), thinking: t('chat.step.thinking'), analysing: t('chat.step.analysing'), visualising: t('chat.step.visualising') }) as Record<string, string>)[k] ?? k;

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    input = ''; busy = true;
    if (ta) ta.style.height = '';
    messages.push({ role: 'user', content: { text: q } });
    const a: Msg = { role: 'assistant', content: {}, pending: true, steps: [], fresh: true, shown: 0, built: false };
    messages.push(a);
    const idx = messages.length - 1;
    await tick(); scrollDown();
    const step = (key: string, label: string) => {
      const m = messages[idx];
      m.steps!.forEach((s) => (s.done = true));
      if (!m.steps!.some((s) => s.key === key)) m.steps!.push({ key, label, done: false });
    };
    ctrl = new AbortController();
    try {
      await askAI({ message: q, chat_id: chatId ?? undefined, dataset_id: ds?.id, lang: i18n.lang }, (e) => {
        const m = messages[idx];
        if (e.event === 'status') step(e.data.step, stepLabel(e.data.step));
        else if (e.event === 'chat') {
          if (!chatId) { chatId = e.data.chat_id; history.replaceState(null, '', `#/chat/${e.data.chat_id}`); route.path = `/chat/${e.data.chat_id}`; route.parts = ['chat', e.data.chat_id]; }
        } else if (e.event === 'query') step(`q-${e.data.id}`, `${t('chat.step.query')}: ${e.data.purpose || e.data.id}`);
        else if (e.event === 'result') { const s = m.steps!.find((x) => x.key === `q-${e.data.id}`); if (s) { s.done = true; s.error = !!e.data.error; s.label += e.data.error ? ' ⚠' : ` · ${e.data.rows}`; } }
        else if (e.event === 'final') { m.steps!.forEach((s) => (s.done = true)); m.content = e.data; m.usage = e.data.usage; m.id = e.data.id; m.pending = false; }
        else if (e.event === 'error') { m.pending = false; m.error = e.data.message; }
      }, ctrl.signal);
    } catch (err) {
      const m = messages[idx];
      m.pending = false; m.error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false; ctrl = null;
      void loadChats();
      void reveal(idx);
    }
  }

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** Ответ «строится» на глазах: текст → блоки по одному (экран следует за новым блоком) → возврат к началу ответа. */
  async function reveal(idx: number) {
    const m = messages[idx];
    const n = m.content?.blocks?.length ?? 0;
    if (m.error || !n) { m.built = true; await tick(); toMessage(idx); return; }
    await tick(); follow();
    const words = String(m.content?.text ?? '').split(/\s+/).length;
    await wait(Math.min(words * 18, 2600) + 300);
    for (let i = 1; i <= n; i++) {
      messages[idx].shown = i;
      await tick(); follow();
      const b = m.content.blocks[i - 1];
      await wait(b?.type === 'chart' || b?.chart ? 1500 : 650);
    }
    messages[idx].built = true;
    await tick(); follow();
    await wait(900);
    toMessage(idx);
  }
  function follow() { requestAnimationFrame(() => scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })); }
  function toMessage(idx: number) {
    const el = document.getElementById(`msg-${idx}`);
    if (el && scroller) scroller.scrollTo({ top: el.offsetTop - 16, behavior: 'smooth' });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void send(); }
  }
  function autosize() { if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'; }

  async function saveReport(m: Msg) {
    const title = m.content.title || messages[messages.indexOf(m) - 1]?.content?.text?.slice(0, 60) || 'Raport';
    const { error } = await supabase.from('reports').insert({ title, content: m.content, dataset_id: m.content.dataset_id ?? ds?.id ?? null });
    if (error) toast(error.message, 'err'); else toast(t('chat.saved'));
  }

  // приветствие: KPI набора данных + подсказки по ролям
  let stats = $state<Record<string, number> | null>(null);
  $effect(() => {
    const d = ds; if (!d) { stats = null; return; }
    const { r } = rolesOf(d);
    const m = [
      ...(r.location ? [{ fn: 'count_distinct', col: r.location, as: 'locations' }] : []),
      ...(r.product_id || r.product ? [{ fn: 'count_distinct', col: (r.product_id ?? r.product)!, as: 'products' }] : []),
      ...(r.manager ? [{ fn: 'count_distinct', col: r.manager, as: 'managers' }] : []),
      { fn: 'count', as: 'records' },
    ];
    agg(d, { metrics: m }).then(([x]) => (stats = x)).catch(() => {});
  });
  const suggestions = $derived.by(() => {
    if (!ds) return [tr('Co potrafisz?', 'What can you do?'), tr('Jak wgrać dane z Excela?', 'How do I upload Excel data?')];
    const { r } = rolesOf(ds);
    const s: string[] = [];
    if (r.manager) s.push(tr('Pokaż top 5 kierowników według przychodu i ich marżę', 'Show top 5 managers by revenue and their margin'));
    if (r.category) s.push(tr('Jaki jest rozkład marży wg kategorii produktów?', 'What is the margin distribution by product category?'));
    if (r.location) s.push(tr('Pokaż punkty sprzedaży na mapie z kolorem wg marży', 'Show points of sale on the map coloured by margin'));
    if (r.manager && r.location) s.push(tr('Narysuj sieć 3D: kierownik → jego punkty', 'Draw a 3D network: manager → their points'));
    if (r.manager && r.category) s.push(tr('Wykres 3D: przychód wg kierownika i kategorii', '3D chart: revenue by manager and category'));
    s.push(tr('Przygotuj raport ryzyk i anomalii', 'Prepare a risks & anomalies report'));
    return s.slice(0, 6);
  });
</script>

<div class="-mt-6 -mb-16 flex h-[calc(100dvh-68px)] flex-col" data-group="ai">
  <div bind:this={scroller} class="relative flex-1 overflow-y-auto">
    <div class="mx-auto w-full max-w-[1060px] px-1 pt-6 pb-10">
      {#if !messages.length}
        <!-- приветствие -->
        <div class="flex min-h-[58vh] flex-col items-center justify-center text-center">
          <div class="mb-8 text-white"><Logo size={44} text={false} animate /></div>
          <h1 class="rise max-w-[860px] text-[36px] leading-[1.02] font-medium tracking-[-0.045em] md:text-[56px]" style="--i:1">{t('chat.welcome')}</h1>
          <p class="rise mt-3 text-[16px] muted" style="--i:2">{t('chat.welcome.sub')}</p>
          {#if stats}
            <div class="mt-9 grid w-full max-w-[760px] grid-cols-2 gap-3 md:grid-cols-4">
              {#each [
                { v: stats.locations, l: t('kpi.locations'), i: 'store', g: 'locations' },
                { v: stats.products, l: t('kpi.products'), i: 'box', g: 'products' },
                { v: stats.managers, l: t('kpi.managers'), i: 'users', g: 'managers' },
                { v: stats.records, l: t('kpi.records'), i: 'database', g: 'finance' },
              ].filter((x) => x.v !== undefined) as k, i}
                <div class="card rise flex items-center gap-3 p-4 text-left" style="--i:{i + 3}" data-group={k.g}>
                  <span class="faint"><Icon name={k.i} size={20} /></span>
                  <div><div class="text-[26px] leading-none font-medium tracking-[-0.03em]"><CountUp value={k.v} format="int" compact={k.v > 99999} /></div><div class="mt-1 text-[12px] faint">{k.l}</div></div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
        <div class="grid gap-2.5 md:grid-cols-2">
          {#each suggestions as s, i}
            <button class="sugg rise" style="--i:{i + 6}" onclick={() => send(s)}>{s}<Icon name="arrowUpRight" size={15} /></button>
          {/each}
        </div>
      {:else}
        {#each messages as m, mi (mi)}
          {#if m.role === 'user'}
            <div class="mb-6 flex justify-end" in:fly={{ y: 10, duration: 400 }}>
              <div class="max-w-[80%] rounded-[22px] rounded-br-md bg-[#232327] px-5 py-3 text-[14.5px] leading-relaxed whitespace-pre-wrap">{m.content.text}</div>
            </div>
          {:else}
            <div id="msg-{mi}" class="mb-10 flex gap-3 md:gap-4" in:fly={{ y: 10, duration: 400 }}>
              <div class="mt-1 hidden h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-[#151517] text-white md:grid">
                <Logo size={15} text={false} />
              </div>
              <div class="min-w-0 flex-1">
                {#if m.steps?.length && m.pending}
                  <div class="mb-4 space-y-1.5" transition:slide>
                    {#each m.steps as s (s.key)}
                      <div class="flex items-center gap-2.5 text-[13px]" in:fly={{ x: -8, duration: 300 }} class:muted={!s.done} class:faint={s.done}>
                        {#if s.done}<span class={s.error ? 'text-[#ef6461]' : 'faint'}><Icon name={s.error ? 'alert' : 'check'} size={14} /></span>
                        {:else}<span class="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-white/15 border-t-white"></span>{/if}
                        {s.label}
                      </div>
                    {/each}
                  </div>
                {/if}
                {#if m.pending && !m.steps?.length}
                  <div class="flex gap-1.5 py-3">{#each [0, 1, 2] as d}<span class="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60" style="animation-delay:{d * 120}ms"></span>{/each}</div>
                {/if}
                {#if m.error}
                  <div class="flex flex-wrap items-center gap-3 rounded-2xl border border-[#ef6461]/30 bg-[#ef6461]/[0.06] px-4 py-3 text-[13.5px] text-[#ffb0b0]" role="alert">
                    <span class="min-w-0 flex-1">{t('chat.error')}: {m.error}</span>
                    <button class="pill pill-sm" disabled={busy} onclick={() => send(messages[mi - 1]?.content?.text)}><Icon name="refresh" size={13} />{tr('Spróbuj ponownie', 'Try again')}</button>
                  </div>
                {/if}
                {#if !m.pending && m.content?.text}
                  <Markdown text={m.content.text} animate={m.fresh} />
                {/if}
                {#if !m.pending && m.content?.blocks?.length}
                  <div class="mt-5"><Blocks blocks={m.content.blocks} results={m.content.results ?? {}} limit={m.fresh && !m.built ? (m.shown ?? 0) : Infinity} /></div>
                {/if}
                {#if !m.pending && m.built !== false && m.content?.suggestions?.length}
                  <div class="mt-5 grid gap-2.5 md:grid-cols-3">
                    {#each m.content.suggestions as s, i}
                      <button class="sugg-card rise" style="--i:{i}; animation-delay:{i * 90}ms" onclick={() => send(s)} disabled={busy}>
                        <span class="block text-[13.5px] font-medium">{s}</span>
                      </button>
                    {/each}
                  </div>
                {/if}
                {#if !m.pending && m.built !== false && (m.content?.text || m.content?.blocks?.length)}
                  <div class="mt-4 flex flex-wrap items-center gap-2 text-[12px] faint">
                    <button class="pill pill-sm pill-ghost" onclick={() => saveReport(m)}><Icon name="bookmark" size={13} />{t('chat.saveReport')}</button>
                    {#if m.content?.queries?.length}<button class="pill pill-sm pill-ghost" onclick={() => (showSql[mi] = !showSql[mi])}><Icon name="code" size={13} />{t('chat.sql')}</button>{/if}
                    {#if m.content?.cached}<span class="badge">{t('chat.cached')}</span>{/if}
                    {#if m.usage?.prompt_tokens}
                      <span title="cache hit / prompt / completion">· {int(m.usage.prompt_tokens + m.usage.completion_tokens)} {t('chat.tokens')} ({Math.round((m.usage.cache_hit_tokens / Math.max(m.usage.prompt_tokens, 1)) * 100)}% cache)</span>
                    {/if}
                  </div>
                  {#if showSql[mi]}
                    <div class="mt-3 space-y-2" transition:slide>
                      {#each m.content.queries as q}
                        <pre class="overflow-x-auto rounded-xl border border-white/[0.06] bg-[#0f0f11] p-3 text-[11.5px] leading-relaxed text-[#a1a1aa]"><span class="text-[#ece8e1]">-- {q.id}: {q.purpose ?? ''} ({q.rows} rows{q.error ? `, ERROR: ${q.error}` : ''})</span>
{q.sql}</pre>
                      {/each}
                    </div>
                  {/if}
                {/if}
              </div>
            </div>
          {/if}
        {/each}
      {/if}
    </div>
  </div>

  <!-- ввод -->
  <div class="no-print shrink-0 px-1 pb-5">
    <div class="composer mx-auto max-w-[1060px]">
      <textarea bind:this={ta} bind:value={input} rows="1" placeholder={t('chat.placeholder')} onkeydown={onKey} oninput={autosize}
        class="block max-h-[200px] w-full resize-none bg-transparent px-5 pt-4 pb-2 text-[15px] outline-none placeholder:text-[#71717a]"></textarea>
      <div class="flex items-center gap-2 px-3 pb-3">
        <a class="icon-btn !h-9 !w-9" href={href('/sources')} title={t('chat.attach')}><Icon name="clip" size={16} /></a>
        <span class="text-[12px] faint">{t('chat.model')}</span>
        {#if busy}
          <button class="ml-auto grid h-10 w-10 place-items-center rounded-full bg-white/10" title="stop" onclick={() => ctrl?.abort()}><span class="h-3 w-3 rounded-sm bg-white"></span></button>
        {:else}
          <button class="ml-auto grid h-10 w-10 place-items-center rounded-full bg-white text-[#0a0a0b] transition disabled:opacity-25" disabled={!input.trim()} onclick={() => send()} aria-label={t('chat.send')}><Icon name="arrowUp" size={18} stroke={2.4} /></button>
        {/if}
      </div>
    </div>
    {#if !ds}<p class="mt-2 text-center text-[12px] faint"><a class="underline" href={href('/sources')}>{t('empty.cta')}</a> — {t('empty.title').toLowerCase()}</p>{/if}
  </div>
</div>

<style>
  .composer { border-radius: 22px; border: 1px solid var(--color-line-2); background: var(--color-surface); transition: border-color .3s; }
  .composer:focus-within { border-color: rgb(255 255 255 / 0.3); }
  .sugg { display: flex; align-items: center; justify-content: space-between; gap: 12px; text-align: left; padding: 15px 18px; border-radius: 16px; border: 1px solid var(--color-line); background: var(--color-surface); font-size: 14px; font-weight: 500; color: var(--color-ink-2); transition: border-color .25s, color .25s; }
  .sugg:hover { border-color: rgb(255 255 255 / 0.22); color: var(--color-ink); }
  .sugg-card { text-align: left; padding: 14px 16px; border-radius: 16px; border: 1px solid var(--color-line); background: var(--color-surface); color: var(--color-ink-2); transition: border-color .25s, color .25s; }
  .sugg-card:hover { border-color: rgb(255 255 255 / 0.22); color: var(--color-ink); }
</style>
