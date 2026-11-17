// Деплой edge functions через Supabase Management API (без supabase CLI).
// SUPABASE_ACCESS_TOKEN=sbp_… node scripts/deploy-functions.mjs [ai users geo connect]
import { readFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const REF = process.env.SUPABASE_PROJECT_REF ?? 'qcmqiviwwhwzxsjmzxkl';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN is required'); process.exit(1); }

const root = new URL('../supabase/functions/', import.meta.url).pathname;
// общий модуль распознавания данных — один источник правды для браузера и сервера
copyFileSync(new URL('../src/lib/data/infer.ts', import.meta.url).pathname, join(root, '_shared/infer.ts'));

const shared = ['_shared/util.ts', '_shared/infer.ts', '_shared/web.ts'];
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['ai', 'users', 'geo', 'connect', 'docs'];

for (const name of names) {
  const form = new FormData();
  form.append('metadata', JSON.stringify({ name, entrypoint_path: `${name}/index.ts`, verify_jwt: false }));
  for (const f of [`${name}/index.ts`, ...shared]) {
    form.append('file', new Blob([readFileSync(join(root, f))], { type: 'application/typescript' }), f);
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/functions/deploy?slug=${name}`, {
    method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: form,
  });
  const txt = await res.text();
  console.log(name, res.status, res.ok ? JSON.parse(txt).version ?? '' : txt.slice(0, 400));
}
