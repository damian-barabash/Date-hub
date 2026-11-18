// Маршрутизация загруженного файла: что это и куда его класть.
//  • таблица данных (продажи, остатки, любая выгрузка с метриками и измерениями) → набор ds.* целиком, все строки;
//  • справочник точек (код + город + адрес) → public.locations;
//  • всё остальное (счета, реестры, бюджеты, договоры, отчёты) → документ (текст для поиска, ИИ и финансового реестра).
// Один модуль для «Dodaj dane» и для загрузки документов — чтобы любой файл обрабатывался одинаково.
import { supabase } from '../supabase';
import { chunks, inferTable, type Inferred } from './infer';

import { classify, DIR_FIELDS } from './classify';
export { classify, directoryMap, DIR_FIELDS, type SheetKind } from './classify';

/** Читает таблицу из файла (лист с наибольшим числом строк) и решает, куда её класть. */
export async function inspectSpreadsheet(file: File, known: Set<string>) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true, dense: true });
  const sizes = wb.SheetNames.map((n) => { const r = wb.Sheets[n]['!ref']; return r ? XLSX.utils.decode_range(r).e.r : 0; });
  const sheet = wb.SheetNames[sizes.indexOf(Math.max(...sizes))];
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: null, raw: true }) as Record<string, unknown>[];
  const inf = inferTable(raw);
  return { inf, sheet, sheets: wb.SheetNames.length, ...classify(inf, known, wb.SheetNames.length) };
}

/** Таблица → набор данных: все строки пакетами по 4000 в 3 потока, затем профиль колонок и активный набор. */
export async function importDataset(inf: Inferred, o: { name: string; file?: string; sheet?: string; period?: string }, onProgress?: (done: number, total: number, phase: string) => void): Promise<string> {
  onProgress?.(0, inf.rows.length, 'create');
  const { data: id, error } = await supabase.rpc('ds_create', {
    p_name: o.name || 'Dane', p_columns: inf.columns, p_roles: inf.roles, p_source: 'file',
    p_meta: { period: o.period || inf.meta.period || undefined, notes: inf.meta.notes, file: o.file, sheet: o.sheet },
  });
  if (error) throw error;
  const queue = chunks(inf.rows, 4000); let done = 0;
  await Promise.all([0, 1, 2].map(async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const { error: e } = await supabase.rpc('ds_insert', { p_id: id, p_rows: p });
      if (e) throw e;
      done += p.length; onProgress?.(done, inf.rows.length, 'insert');
    }
  }));
  onProgress?.(done, inf.rows.length, 'finalize');
  const { error: fe } = await supabase.rpc('ds_finalize', { p_id: id });
  if (fe) throw fe;
  await supabase.rpc('ds_set_active', { p_id: id });
  return id as string;
}

/** Справочник точек → public.locations (адреса потом геокодирует браузер). */
export async function importDirectory(inf: Inferred, map: Record<string, string>): Promise<number> {
  const rows = inf.rows.filter((r) => r[map.code]).map((r) => Object.fromEntries(DIR_FIELDS.map((f) => [f.k, map[f.k] ? (r[map[f.k]] ?? null) : null])));
  const { data, error } = await supabase.rpc('locations_import', { p_rows: rows });
  if (error) throw error;
  return Number(data);
}
