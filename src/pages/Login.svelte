<script lang="ts">
  import { supabase, loginToEmail } from '../lib/supabase';
  import { i18n, setLang, t, tr } from '../lib/i18n.svelte';
  import Logo from '../lib/ui/Logo.svelte';
  import Icon from '../lib/ui/Icon.svelte';

  let login = $state('');
  let pass = $state('');
  let show = $state(false);
  let busy = $state(false);
  let err = $state('');

  async function submit(e: Event) {
    e.preventDefault();
    if (!login || !pass) return;
    busy = true; err = '';
    const { error } = await supabase.auth.signInWithPassword({ email: loginToEmail(login), password: pass });
    busy = false;
    if (error) err = t('login.error');
  }

  // спокойный фон: столбцы и одна линия тренда
  // шесть линий по очереди «строят» графики, цикл бесконечный
  const lines = [
    { d: 'M0 330 C 140 310, 240 340, 380 270 S 600 210, 740 190 S 900 120, 1000 80', c: '#ff6a3d', w: 1.8, o: 1 },
    { d: 'M0 370 C 120 360, 260 300, 400 320 S 620 250, 760 260 S 920 180, 1000 170', c: '#f4f4f5', w: 1.2, o: 0.5 },
    { d: 'M0 290 C 160 300, 250 240, 390 230 S 610 260, 730 150 S 910 130, 1000 40', c: '#f4f4f5', w: 1.2, o: 0.28 },
    { d: 'M0 400 C 150 380, 280 390, 420 350 S 640 340, 780 300 S 930 270, 1000 240', c: '#7b61ff', w: 1.4, o: 0.75 },
    { d: 'M0 350 C 130 330, 230 370, 370 310 S 590 290, 720 230 S 900 210, 1000 120', c: '#f4f4f5', w: 1.2, o: 0.38 },
    { d: 'M0 410 C 170 400, 300 360, 440 380 S 660 310, 790 330 S 940 290, 1000 300', c: '#ff6a3d', w: 1.2, o: 0.45 },
  ];
  const bars = Array.from({ length: 28 }, (_, i) => 40 + Math.abs(Math.sin(i * 1.3) * 110) + i * 5);
</script>

<div class="relative flex min-h-full overflow-y-auto">
  <div class="relative z-10 grid w-full lg:grid-cols-[1.2fr_1fr]">
    <section class="relative isolate hidden flex-col justify-between overflow-hidden border-r border-white/[0.06] p-12 lg:flex">
      <div class="text-white"><Logo size={28} animate /></div>
      <div>
        <h1 class="rise text-[72px] leading-[0.95] font-medium tracking-[-0.055em] xl:text-[96px]" style="--i:1">
          {tr('Sprzedaż sieci.', 'Network sales.')}<br /><span class="text-[#71717a]">{tr('Jedno miejsce.', 'One place.')}</span>
        </h1>
        <p class="rise mt-8 max-w-[440px] text-[16px] leading-relaxed muted" style="--i:2">
          {tr('Kierownicy, punkty, produkty i marże CK Complex. Pytasz — dostajesz wykres, mapę albo raport.',
              'CK Complex managers, points, products and margins. You ask — you get a chart, a map or a report.')}
        </p>
      </div>
      <div class="text-[13px] faint">© {new Date().getFullYear()} CK Complex</div>
      <svg class="pointer-events-none absolute right-0 bottom-0 left-0 -z-10 h-[46%] w-full" viewBox="0 0 1000 420" preserveAspectRatio="none">
        <g class="bars">
          {#each bars as h, i}
            <rect x={i * 36 + 4} y={420 - h} width="22" height={h} rx="4" fill="rgba(255,255,255,0.03)" style="animation-delay:{i * 30}ms" />
          {/each}
        </g>
        {#each lines as l, i}
          <path d={l.d} fill="none" stroke={l.c} stroke-width={l.w} stroke-linecap="round" pathLength="1" class="ln" vector-effect="non-scaling-stroke" style="animation-delay:{i * 1.1}s; --o:{l.o}" />
        {/each}
      </svg>
    </section>

    <!-- право: форма -->
    <section class="flex min-h-full items-center justify-center p-5 sm:p-10">
      <form class="rise w-full max-w-[400px]" style="--i:2" onsubmit={submit}>
        <div class="mb-12 text-white lg:hidden"><Logo size={26} /></div>
        <div class="mb-2 flex items-center justify-between">
          <h2 class="text-[40px] font-medium tracking-[-0.04em]">{t('login.title')}</h2>
          <div class="flex rounded-full border border-white/10 p-0.5 text-[12.5px] font-bold">
            {#each ['pl', 'en'] as l}
              <button type="button" class="rounded-full px-2.5 py-1 uppercase" class:bg-white={i18n.lang === l} class:text-black={i18n.lang === l} class:faint={i18n.lang !== l} onclick={() => setLang(l as 'pl' | 'en')}>{l}</button>
            {/each}
          </div>
        </div>
        <p class="mb-8 text-[15px] muted">{t('login.subtitle')}</p>

        <label class="label" for="login">{t('login.user')}</label>
        <div class="relative mb-4">
          <span class="absolute top-1/2 left-4 -translate-y-1/2 faint"><Icon name="users" size={16} /></span>
          <!-- svelte-ignore a11y_autofocus -->
          <input id="login" class="input !h-[50px] !pl-11" autocomplete="username" autocapitalize="none" autofocus bind:value={login} />
        </div>
        <label class="label" for="pass">{t('login.pass')}</label>
        <div class="relative">
          <span class="absolute top-1/2 left-4 -translate-y-1/2 faint"><Icon name="key" size={16} /></span>
          <input id="pass" class="input !h-[50px] !pr-12 !pl-11" type={show ? 'text' : 'password'} autocomplete="current-password" bind:value={pass} />
          <button type="button" class="absolute top-1/2 right-3 -translate-y-1/2 rounded-lg p-1.5 faint hover:text-white" aria-label={t('login.show')} onclick={() => (show = !show)}><Icon name="eye" size={16} /></button>
        </div>
        {#if err}<div role="alert" class="mt-4 flex items-center gap-2 rounded-xl bg-[#f04438]/10 px-4 py-3 text-[14px] font-semibold text-[#ff8f8f] rise"><Icon name="alert" size={15} />{err}</div>{/if}
        <button class="pill pill-accent mt-7 !h-[52px] w-full justify-center !text-[16px]" disabled={busy || !login || !pass}>
          {#if busy}<span class="spin inline-block h-4 w-4 rounded-full border-2 border-black/30 border-t-black"></span>{:else}{t('login.submit')}<Icon name="arrowUpRight" size={17} />{/if}
        </button>
      </form>
    </section>
  </div>
</div>

<style>
  .ln { stroke-dasharray: 1; stroke-dashoffset: 1; opacity: 0; animation: build 6.6s cubic-bezier(.65,0,.35,1) infinite both; }
  @keyframes build {
    0% { stroke-dashoffset: 1; opacity: var(--o); }
    46% { stroke-dashoffset: 0; opacity: var(--o); }
    78% { stroke-dashoffset: 0; opacity: var(--o); }
    100% { stroke-dashoffset: 0; opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) { .ln { animation: none; stroke-dashoffset: 0; opacity: var(--o); } }
  .bars rect { transform-origin: bottom; transform-box: fill-box; animation: grow 1.2s cubic-bezier(.16,1,.3,1) both; }
  @keyframes grow { from { transform: scaleY(0); } }
</style>
