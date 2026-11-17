<script lang="ts">
  import { t } from '../i18n.svelte';
  import { href } from '../router.svelte';
  import Icon from './Icon.svelte';
  let { role = '' }: { role?: string } = $props();
</script>

<div class="card rise mx-auto mt-10 max-w-xl p-10 text-center" data-group="ai">
  <div class="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-white/10 muted">
    <Icon name={role ? 'layers' : 'database'} size={28} />
  </div>
  {#if role}
    <h2 class="text-xl font-semibold">{t('empty.role')} «{role}»</h2>
    <p class="mt-2 muted">{t('empty.text')}</p>
    <a class="pill pill-accent mt-6" href={href('/sources')}>{t('empty.role.cta')}</a>
  {:else}
    <h2 class="text-xl font-semibold">{t('empty.title')}</h2>
    <p class="mt-2 muted">{t('empty.text')}</p>
    <a class="pill pill-accent mt-6" href={href('/sources')}><Icon name="upload" size={16} />{t('empty.cta')}</a>
  {/if}
</div>
