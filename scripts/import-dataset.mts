// Загрузка таблицы продаж (xlsx/csv) в воркспейс — тот же конвейер, что в браузере (Upload.svelte):
// SheetJS → распознавание (infer.ts) → ds_create → ds_insert пакетами → ds_finalize → активный набор.
// DH_JWT=<токен пользователя> DH_WS=<id воркспейса> node --experimental-strip-types scripts/import-dataset.mts <файл> [название]
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { chunks, inferTable } from '../src/lib/data/infer.ts';

const [file, name] = process.argv.slice(2);
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_KEY, { global: { headers: { authorization: `Bearer ${process.env.DH_JWT}`, 'x-workspace': process.env.DH_WS ?? '' } }, auth: { persistSession: false } });

const wb = XLSX.read(readFileSync(file), { type: 'buffer', cellDates: true, dense: true });
const sizes = wb.SheetNames.map((n) => { const r = wb.Sheets[n]['!ref']; return r ? XLSX.utils.decode_range(r).e.r : 0; });
const sheet = wb.SheetNames[sizes.indexOf(Math.max(...sizes))];
const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: null, raw: true }) as Record<string, unknown>[];
const inf = inferTable(raw);
console.log(`${basename(file)} / ${sheet}: ${inf.rows.length} wierszy, okres ${inf.meta.period ?? '?'}, role`, inf.roles);
const { data: id, error } = await sb.rpc('ds_create', { p_name: name || basename(file).replace(/\.[^.]+$/, ''), p_columns: inf.columns, p_roles: inf.roles, p_source: 'file', p_meta: { period: inf.meta.period, notes: inf.meta.notes, file: basename(file), sheet } });
if (error) throw error;
const queue = chunks(inf.rows, 4000); let done = 0;
await Promise.all([0, 1, 2].map(async () => { for (let p = queue.shift(); p; p = queue.shift()) { const { error: e } = await sb.rpc('ds_insert', { p_id: id, p_rows: p }); if (e) throw e; done += p.length; process.stdout.write(`\r${done}/${inf.rows.length}`); } }));
const { data: d, error: fe } = await sb.rpc('ds_finalize', { p_id: id });
if (fe) throw fe;
await sb.rpc('ds_set_active', { p_id: id });
console.log(`\ngotowe: ${id} → ds.${(d as any).table_name}, ${(d as any).row_count} wierszy`);
