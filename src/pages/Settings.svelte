<script lang="ts">
  import { supabase, fn } from '../lib/supabase';
  import { app, toast } from '../lib/stores/app.svelte';
  import { i18n, setLang, t, tr } from '../lib/i18n.svelte';
  import { dateTime, int, pct } from '../lib/format';
  import PageHeader from '../lib/ui/PageHeader.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Kpi from '../lib/ui/Kpi.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Chart from '../lib/charts/Chart.svelte';

  type AiS = { model: string; temperature: number; history_turns: number; rows_to_model: number; rows_to_client: number; cache: boolean; cache_ttl_hours: number; max_rounds: number };
  let ai = $state<AiS | null>(null);
  let pricing = $state({ input_hit: 0.028, input_miss: 0.28, output: 0.42, currency: 'USD' });
  let usage = $state<any[]>([]);
  let users = $state<any[]>([]);
  let nu = $state({ username: '', password: '', display_name: '' });
  let pwFor = $state<string | null>(null);
  let pw = $state('');

  async function refresh() {
    const [{ data: st }, { data: u }] = await Promise.all([
      supabase.from('app_settings').select('*'),
      supabase.from('ai_usage').select('*').gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString()).order('created_at').limit(5000),
    ]);
    ai = st?.find((x) => x.key === 'ai')?.value ?? null;
    const p = st?.find((x) => x.key === 'pricing')?.value; if (p) pricing = p;
    usage = u ?? [];
    try { users = await fn('users', { action: 'list' }); } catch (e) { toast(String(e), 'err'); }
  }
  $effect(() => { void refresh(); });

  async function saveAi() {
    const [{ error }, { error: e2 }] = await Promise.all([
      supabase.from('app_settings').upsert({ key: 'ai', value: ai, updated_at: new Date().toISOString() }),
      supabase.from('app_settings').upsert({ key: 'pricing', value: pricing, updated_at: new Date().toISOString() }),
    ]);
    toast(error || e2 ? (error ?? e2)!.message : 'OK', error || e2 ? 'err' : 'ok');
  }
  async function clearCache() {
    const { data } = await supabase.rpc('ai_cache_clear');
    toast(`${t('set.clearCache')}: ${data ?? 0}`);
  }
  async function addUser() {
    try { await fn('users', { action: 'create', ...nu }); nu = { username: '', password: '', display_name: '' }; toast('OK'); await refresh(); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'err'); }
  }
  async function delUser(u: any) {
    if (!confirm(`${t('common.confirm')} ${u.username}`)) return;
    try { await fn('users', { action: 'delete', id: u.id }); await refresh(); } catch (e) { toast(String(e), 'err'); }
  }
  async function setPw(id: string) {
    try { await fn('users', { action: 'password', id, password: pw }); pwFor = null; pw = ''; toast('OK'); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'err'); }
  }

  const sum = $derived(usage.reduce((a, u) => ({ prompt: a.prompt + (u.prompt_tokens ?? 0), hit: a.hit + (u.cache_hit_tokens ?? 0), out: a.out + (u.completion_tokens ?? 0), n: a.n + 1, cached: a.cached + (u.cached_answer ? 1 : 0) }), { prompt: 0, hit: 0, out: 0, n: 0, cached: 0 }));
  const cost = $derived((sum.hit * pricing.input_hit + (sum.prompt - sum.hit) * pricing.input_miss + sum.out * pricing.output) / 1e6);
  const daily = $derived.by(() => {
    const m = new Map<string, { day: string; input: number; cache: number; output: number }>();
    for (const u of usage) {
      const d = u.created_at.slice(0, 10);
      const a = m.get(d) ?? { day: d, input: 0, cache: 0, output: 0 };
      a.input += (u.prompt_tokens ?? 0) - (u.cache_hit_tokens ?? 0); a.cache += u.cache_hit_tokens ?? 0; a.output += u.completion_tokens ?? 0;
      m.set(d, a);
    }
    return [...m.values()];
  });
</script>

<PageHeader title={t('set.title')} sub={t('set.sub')} />

<div class="kpis">
  <Kpi i={0} label={tr('Zapytania AI (30 dni)', 'AI requests (30 days)')} value={sum.n} format="int" compact={false} icon="sparkles" group="ai" hint="{int(sum.cached)} {tr('z pamięci', 'from cache')}" />
  <Kpi i={1} label={tr('Tokeny', 'Tokens')} value={sum.prompt + sum.out} format="int" icon="layers" group="managers" hint="in {int(sum.prompt)} · out {int(sum.out)}" />
  <Kpi i={2} label={tr('Trafienia cache', 'Cache hit rate')} value={sum.prompt ? sum.hit / sum.prompt : 0} format="pct" icon="bolt" group="finance" hint={tr('tańsze tokeny wejściowe', 'cheaper input tokens')} />
  <Kpi i={3} label={tr('Szacowany koszt', 'Estimated cost')} value={cost} format="num" icon="coins" group="products" hint={pricing.currency} />
</div>

<div class="mt-4 grid gap-4 xl:grid-cols-2">
  <Panel title={t('set.ai')} sub={tr('Parametry modelu i oszczędzania tokenów', 'Model and token-saving parameters')} icon="sparkles" group="ai" i={1}>
    {#if ai}
      <div class="grid gap-4 sm:grid-cols-2">
        <div><label class="label" for="m">Model</label>
          <select id="m" class="input" bind:value={ai.model}><option value="deepseek-chat">{tr('Szybki', 'Fast')}</option><option value="deepseek-reasoner">{tr('Pogłębiona analiza', 'Deep reasoning')}</option></select></div>
        <div><label class="label" for="tmp">{tr('Temperatura', 'Temperature')}: {ai.temperature}</label><input id="tmp" type="range" min="0" max="1" step="0.05" class="w-full accent-[#ff6a3d]" bind:value={ai.temperature} /></div>
        <div><label class="label" for="ht">{tr('Historia rozmowy (wymian)', 'Chat history (turns)')}</label><input id="ht" class="input" type="number" min="0" max="20" bind:value={ai.history_turns} /></div>
        <div><label class="label" for="mr">{tr('Maks. rund zapytań SQL', 'Max SQL query rounds')}</label><input id="mr" class="input" type="number" min="1" max="6" bind:value={ai.max_rounds} /></div>
        <div><label class="label" for="rm">{tr('Wierszy wyniku dla modelu', 'Result rows sent to model')}</label><input id="rm" class="input" type="number" min="5" max="200" bind:value={ai.rows_to_model} /></div>
        <div><label class="label" for="rc">{tr('Wierszy wyniku dla wykresu', 'Result rows for charts')}</label><input id="rc" class="input" type="number" min="50" max="2000" bind:value={ai.rows_to_client} /></div>
        <div class="flex items-center gap-3 sm:col-span-2">
          <label class="flex cursor-pointer items-center gap-2 text-[14px] font-semibold"><input type="checkbox" class="h-4 w-4 accent-[#ff6a3d]" bind:checked={ai.cache} />{t('set.cache')}</label>
          <input class="input !h-9 !w-24" type="number" min="1" bind:value={ai.cache_ttl_hours} /><span class="text-[13.5px] faint">{tr('godzin', 'hours')}</span>
          <button class="pill pill-sm ml-auto" onclick={clearCache}><Icon name="trash" size={13} />{t('set.clearCache')}</button>
        </div>
        <div class="sm:col-span-2">
          <div class="label">{tr('Cennik (za 1 mln tokenów)', 'Pricing (per 1M tokens)')}</div>
          <div class="grid grid-cols-3 gap-2">
            <input class="input" type="number" step="0.001" bind:value={pricing.input_hit} title="input cache hit" />
            <input class="input" type="number" step="0.001" bind:value={pricing.input_miss} title="input cache miss" />
            <input class="input" type="number" step="0.001" bind:value={pricing.output} title="output" />
          </div>
          <div class="mt-1 text-[12.5px] faint">cache hit · cache miss · output</div>
        </div>
      </div>
      <button class="pill pill-accent mt-5" onclick={saveAi}>{t('common.save')}</button>
    {/if}
  </Panel>

  <Panel title={t('set.usage')} sub={tr('Ostatnie 30 dni', 'Last 30 days')} icon="report" group="managers" i={2}>
    <Chart height={300} rows={daily} spec={{ chart: 'bar', x: 'day', y: ['cache', 'input', 'output'], stack: true, format: 'int', group: 'finance', labels: { cache: 'cache hit', input: 'input', output: 'output' } }} />
    <div class="mt-4 rounded-2xl bg-white/[0.025] p-4 text-[13.5px] leading-relaxed muted">
      <b class="text-white">{tr('Jak oszczędzamy tokeny', 'How we save tokens')}:</b>
      {tr('model dostaje opis kolumn zamiast danych i sam pisze SQL; wyniki trafiają do niego skrócone; wykresy odwołują się do wyników zapytań (model nie przepisuje liczb); stała część zapytania jest cache’owana; identyczne pytania obsługuje pamięć odpowiedzi.',
        'the model gets a column description instead of data and writes SQL itself; results reach it truncated; charts reference query results (the model never re-types numbers); the fixed part of the request is cached; identical questions are served from the answer cache.')}
      {#if sum.prompt}<div class="mt-2">{tr('Udział cache w tokenach wejściowych', 'Cache share of input tokens')}: <b class="text-white">{pct(sum.hit / sum.prompt)}</b></div>{/if}
    </div>
  </Panel>
</div>

<div class="mt-4 grid gap-4 xl:grid-cols-3">
  <Panel class="xl:col-span-2" title={t('set.users')} sub={tr('Konta bez ról — każdy widzi wszystkie dane', 'Accounts without roles — everyone sees all data')} icon="users" group="managers" i={3}>
    <div class="space-y-2">
      {#each users as u, i (u.id)}
        <div class="flex flex-wrap items-center gap-3 rounded-2xl bg-white/[0.025] px-4 py-3 rise" style="--i:{i}">
          <div class="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 text-[14px] font-medium uppercase">{u.username?.slice(0, 1)}</div>
          <div class="min-w-0 flex-1">
            <div class="font-bold">{u.display_name ?? u.username} {#if u.me}<span class="badge ml-1">{tr('Ty', 'You')}</span>{/if}</div>
            <div class="text-[13px] faint">{u.username} · {u.last_sign_in_at ? `${tr('ostatnio', 'last')}: ${dateTime(u.last_sign_in_at)}` : tr('nie logował się', 'never signed in')}</div>
          </div>
          {#if pwFor === u.id}
            <input class="input !h-9 !w-44" type="password" placeholder={tr('nowe hasło', 'new password')} bind:value={pw} />
            <button class="pill pill-sm pill-accent" onclick={() => setPw(u.id)}>{t('common.save')}</button>
          {:else}
            <button class="pill pill-sm" onclick={() => { pwFor = u.id; pw = ''; }}><Icon name="key" size={13} />{tr('Hasło', 'Password')}</button>
          {/if}
          {#if !u.me}<button class="pill pill-sm" data-group="alerts" onclick={() => delUser(u)}><Icon name="trash" size={13} /></button>{/if}
        </div>
      {/each}
    </div>
    <div class="mt-5 grid gap-3 border-t border-white/[0.06] pt-5 sm:grid-cols-[1fr_1fr_1fr_auto]">
      <input class="input" placeholder={t('login.user')} bind:value={nu.username} autocomplete="off" />
      <input class="input" placeholder={tr('Imię i nazwisko', 'Full name')} bind:value={nu.display_name} autocomplete="off" />
      <input class="input" type="password" placeholder={t('login.pass')} bind:value={nu.password} autocomplete="new-password" />
      <button class="pill pill-accent !h-[42px]" onclick={addUser} disabled={!nu.username || nu.password.length < 8}><Icon name="plus" size={15} />{t('set.addUser')}</button>
    </div>
  </Panel>

  <Panel title={t('set.lang')} icon="globe" group="ai" i={4}>
    <div class="grid grid-cols-2 gap-2">
      {#each [['pl', 'Polski'], ['en', 'English']] as [k, l]}
        <button class="rounded-2xl border px-4 py-4 text-left font-bold transition" style={i18n.lang === k ? 'border-color:rgb(255 255 255 / 0.3); background:rgb(255 255 255 / 0.07)' : 'border-color:var(--color-line-2)'} onclick={() => setLang(k as 'pl' | 'en')}>
          <div class="text-[20px]">{k.toUpperCase()}</div><div class="text-[14px] muted">{l}</div>
        </button>
      {/each}
    </div>
    <div class="mt-5 text-[13px] faint">{tr('Zalogowany jako', 'Signed in as')} <b class="text-white">{app.session?.user?.user_metadata?.username}</b></div>
  </Panel>
</div>
