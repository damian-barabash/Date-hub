<script lang="ts">
  import { supabase } from '../lib/supabase';
  import { app, toast } from '../lib/stores/app.svelte';
  import { t, tr } from '../lib/i18n.svelte';
  import { go, href, route } from '../lib/router.svelte';
  import { dateTime } from '../lib/format';
  import PageHeader from '../lib/ui/PageHeader.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Logo from '../lib/ui/Logo.svelte';
  import Blocks from '../lib/chat/Blocks.svelte';
  import Markdown from '../lib/chat/Markdown.svelte';

  type Report = { id: string; title: string; content: any; created_at: string; dataset_id: string | null };
  let list = $state<Report[]>([]);
  let loading = $state(true);
  const id = $derived(route.parts[1] ?? null);
  const current = $derived(list.find((r) => r.id === id) ?? null);

  async function refresh() {
    const { data } = await supabase.from('reports').select('*').order('created_at', { ascending: false });
    list = (data ?? []) as Report[];
    loading = false;
  }
  $effect(() => { void refresh(); });

  async function del(r: Report) {
    if (!confirm(t('common.confirm'))) return;
    await supabase.from('reports').delete().eq('id', r.id);
    toast('OK'); go('/reports'); await refresh();
  }
  const presets = [
    { k: 'rep.monthly', icon: 'calendar', g: 'finance', q: () => tr('Przygotuj pełny raport miesięczny: KPI, kierownicy, punkty, kategorie, marże, ryzyka i rekomendacje', 'Prepare a full monthly report: KPIs, managers, points, categories, margins, risks and recommendations') },
    { k: 'rep.managers', icon: 'users', g: 'managers', q: () => tr('Raport kierowników: ranking, efektywność na punkt, marże, porównanie i sieć 3D kierownik → punkty', 'Managers report: ranking, efficiency per point, margins, comparison and a 3D manager → points network') },
    { k: 'rep.risks', icon: 'alert', g: 'alerts', q: () => tr('Raport ryzyk i anomalii: ujemne marże, zwroty, słabe punkty, odchylenia od średniej', 'Risks & anomalies report: negative margins, returns, weak points, deviations from average') },
    { k: 'rep.products', icon: 'box', g: 'products', q: () => tr('Raport produktowy: bestsellery, kategorie, marże, produkty do wycofania', 'Product report: bestsellers, categories, margins, products to delist') },
    { k: 'rep.geo', icon: 'map', g: 'locations', q: () => tr('Raport geograficzny: mapa punktów, wyniki wg miast i województw', 'Geographic report: map of points, results by city and region') },
  ] as const;
</script>

{#if id && current}
  <div class="no-print mb-5 flex flex-wrap gap-2">
    <a class="pill" href={href('/reports')}><Icon name="left" size={14} />{t('common.back')}</a>
    <button class="pill" onclick={() => window.print()}><Icon name="printer" size={15} />{t('common.print')}</button>
    <button class="pill" data-group="alerts" onclick={() => del(current)}><Icon name="trash" size={15} />{t('common.delete')}</button>
  </div>
  <article class="mx-auto max-w-[1180px]">
    <header class="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.07] pb-6 rise">
      <div>
        <div class="mb-4 text-white"><Logo size={22} /></div>
        <h1 class="text-[34px] leading-tight font-semibold tracking-[-0.03em]">{current.title}</h1>
        <p class="mt-1 text-[14px] faint">{dateTime(current.created_at)} · {app.datasets.find((d) => d.id === current.dataset_id)?.name ?? ''}</p>
      </div>
    </header>
    {#if current.content?.text}<div class="mb-8 max-w-[900px] rise" style="--i:1"><Markdown text={current.content.text} /></div>{/if}
    <Blocks blocks={current.content?.blocks ?? []} results={current.content?.results ?? {}} />
  </article>
{:else}
  <PageHeader title={t('rep.title')} sub={t('rep.sub')} />

  <div class="mb-8">
    <div class="mb-3 text-[13px] font-bold tracking-widest uppercase faint">{t('rep.generate')}</div>
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {#each presets as p, i}
        <button class="card card-pad group rise text-left transition hover:-translate-y-1" style="--i:{i}" data-group={p.g} onclick={() => go(`/chat?q=${encodeURIComponent(p.q())}`)}>
          <span class="grid h-10 w-10 place-items-center rounded-xl border border-white/10 muted"><Icon name={p.icon} size={18} /></span>
          <div class="mt-4 text-[15px] font-bold">{t(p.k)}</div>
          <div class="mt-1 flex items-center gap-1 text-[13px] faint group-hover:text-white">{tr('Wygeneruj z AI', 'Generate with AI')}<Icon name="arrowUpRight" size={13} /></div>
        </button>
      {/each}
    </div>
  </div>

  {#if loading}
    <div class="grid gap-3 md:grid-cols-3">{#each [0, 1, 2] as _}<div class="skeleton h-32"></div>{/each}</div>
  {:else if !list.length}
    <div class="card card-pad text-center muted">{t('rep.empty')}</div>
  {:else}
    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {#each list as r, i (r.id)}
        <a class="card card-pad rise block transition hover:-translate-y-1 hover:border-white/15" style="--i:{i}" href={href(`/reports/${r.id}`)} data-group="ai">
          <div class="flex items-start justify-between gap-3">
            <span class="grid h-10 w-10 place-items-center rounded-xl border border-white/10 muted"><Icon name="report" size={18} /></span>
            <span class="text-[12.5px] faint">{dateTime(r.created_at)}</span>
          </div>
          <div class="mt-4 line-clamp-2 text-[16px] font-bold">{r.title}</div>
          <div class="mt-2 line-clamp-2 text-[13.5px] faint">{String(r.content?.text ?? '').replace(/[*#_]/g, '').slice(0, 160)}</div>
          <div class="mt-4 flex gap-2">
            <span class="badge">{(r.content?.blocks ?? []).length} {tr('wizualizacji', 'visuals')}</span>
          </div>
        </a>
      {/each}
    </div>
  {/if}
{/if}
