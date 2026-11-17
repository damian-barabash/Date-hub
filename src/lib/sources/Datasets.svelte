<script lang="ts">
  import { slide } from 'svelte/transition';
  import { supabase } from '../supabase';
  import { app, loadDatasets, toast, type Dataset } from '../stores/app.svelte';
  import { clearCache } from '../data/api';
  import { t, tr } from '../i18n.svelte';
  import { dateTime, int } from '../format';
  import type { Role } from '../data/infer';
  import Icon from '../ui/Icon.svelte';
  import { i18nRole } from './Upload.svelte';

  const ROLES: Role[] = ['manager', 'employee', 'location', 'customer', 'product', 'product_id', 'category', 'brand', 'qty', 'net', 'gross', 'margin', 'profit', 'cost', 'price', 'date', 'city', 'region', 'lat', 'lng'];
  let editing = $state<string | null>(null);
  let draft = $state<Record<string, string>>({});

  async function activate(d: Dataset) {
    await supabase.rpc('ds_set_active', { p_id: d.id });
    clearCache(); await loadDatasets(); toast(`${t('src.active')}: ${d.name}`);
  }
  async function drop(d: Dataset) {
    if (!confirm(`${t('common.confirm')} «${d.name}» — ${int(d.row_count)} ${t('common.rows')}`)) return;
    const { error } = await supabase.rpc('ds_drop', { p_id: d.id });
    if (error) return toast(error.message, 'err');
    clearCache(); await loadDatasets(); toast('OK');
  }
  function edit(d: Dataset) {
    editing = editing === d.id ? null : d.id;
    draft = Object.fromEntries(d.columns.map((c) => [c.key, c.role ?? '']));
  }
  async function saveRoles(d: Dataset) {
    const roles: Record<string, string> = {};
    const columns = d.columns.map((c) => {
      const r = draft[c.key];
      if (r) roles[r] = c.key;
      return { ...c, role: r || undefined };
    });
    const { error } = await supabase.from('datasets').update({ roles, columns, version: d.version + 1, updated_at: new Date().toISOString() }).eq('id', d.id);
    if (error) return toast(error.message, 'err');
    await supabase.rpc('ai_cache_clear');
    clearCache(); await loadDatasets(); editing = null; toast('OK');
  }
</script>

{#if !app.datasets.length}
  <div class="card card-pad text-center muted">{t('empty.text')}</div>
{:else}
  <div class="space-y-3">
    {#each app.datasets as d, i (d.id)}
      <div class="card overflow-hidden rise" style="--i:{i}" data-group={d.is_active ? 'finance' : 'ai'}>
        <div class="flex flex-wrap items-center gap-4 p-5">
          <span class="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 muted"><Icon name={d.source === 'file' ? 'layers' : 'link'} size={19} /></span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="truncate text-[16px] font-semibold">{d.name}</span>
              {#if d.is_active}<span class="badge">{t('src.active')}</span>{/if}
              {#if d.status !== 'ready'}<span data-group="alerts"><span class="badge">{d.status}</span></span>{/if}
            </div>
            <div class="mt-0.5 text-[13.5px] faint">{d.source} · {int(d.row_count)} {t('common.rows')} · {d.columns.length} {tr('kolumn', 'columns')}{d.meta?.period ? ` · ${d.meta.period}` : ''} · {dateTime(d.created_at)}</div>
          </div>
          <div class="flex flex-wrap gap-2">
            {#if !d.is_active && d.status === 'ready'}<button class="pill pill-sm" onclick={() => activate(d)}><Icon name="check" size={13} />{t('src.activate')}</button>{/if}
            <button class="pill pill-sm" onclick={() => edit(d)}><Icon name="settings" size={13} />{t('src.roles')}</button>
            <button class="pill pill-sm" data-group="alerts" onclick={() => drop(d)}><Icon name="trash" size={13} />{t('common.delete')}</button>
          </div>
        </div>
        {#if editing === d.id}
          <div class="border-t border-white/[0.06] p-5" transition:slide>
            <p class="mb-4 text-[13.5px] faint">{tr('Role mówią systemowi, co oznacza kolumna — od nich zależą dashboardy i podpowiedzi dla AI.', 'Roles tell the system what a column means — dashboards and AI hints depend on them.')}</p>
            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {#each d.columns as c (c.key)}
                <div class="flex items-center gap-3 rounded-xl bg-white/[0.025] px-3 py-2">
                  <div class="min-w-0 flex-1"><div class="truncate text-[14px] font-bold">{c.label}</div><div class="text-[12.5px] faint">{c.type}{c.derived ? ' · auto' : ''}</div></div>
                  <select class="input !h-8 !w-[150px] !text-[13px]" bind:value={draft[c.key]}>
                    <option value="">—</option>
                    {#each ROLES as r}<option value={r}>{i18nRole(r)}</option>{/each}
                  </select>
                </div>
              {/each}
            </div>
            <div class="mt-4 flex gap-2"><button class="pill pill-accent" onclick={() => saveRoles(d)}>{t('common.save')}</button><button class="pill" onclick={() => (editing = null)}>{t('common.cancel')}</button></div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
