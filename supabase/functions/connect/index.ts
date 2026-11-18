// Коннекторы данных: REST/JSON (POS, ERP, открытые API), файл по ссылке (CSV/XLSX/JSON, Google Sheets),
// внешние базы Postgres и MySQL. Любой источник → inferTable → таблица ds.* (как загруженный Excel).
// action: test (предпросмотр) | sync (загрузка) | cron (плановая синхронизация, x-cron-secret)
// на сервере — npm-сборка SheetJS (бандлер Supabase не тянет cdn.sheetjs.com)
import * as XLSX from 'npm:xlsx@0.18.5';
import { admin, cors, json, requireUser, requireWorkspace } from '../_shared/util.ts';
import { chunks, inferTable, pickArray } from '../_shared/infer.ts';

type Rows = Record<string, unknown>[];
const MAX_ROWS = 500_000;

async function fetchRows(kind: string, config: any, secret: any): Promise<Rows> {
  switch (kind) {
    case 'rest': {
      const headers: Record<string, string> = { accept: 'application/json', ...(config.headers ?? {}), ...(secret?.headers ?? {}) };
      const out: Rows = [];
      const pag = config.pagination as { param: string; start?: number; max?: number } | undefined;
      let page = pag?.start ?? 1;
      for (let i = 0; i < (pag ? pag.max ?? 50 : 1); i++) {
        const u = new URL(config.url);
        if (pag) u.searchParams.set(pag.param, String(page++));
        const res = await fetch(u, {
          method: config.method ?? 'GET', headers,
          ...(config.body ? { body: typeof config.body === 'string' ? config.body : JSON.stringify(config.body) } : {}),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const rows = pickArray(await res.json(), config.path);
        if (!rows.length) break;
        out.push(...rows);
        if (out.length > MAX_ROWS) break;
      }
      return out;
    }
    case 'file_url': {
      const res = await fetch(config.url, { headers: secret?.headers ?? {} });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get('content-type') ?? '';
      const fmt = config.format ?? (/json/.test(ct) || /\.json(\?|$)/i.test(config.url) ? 'json' : 'sheet');
      if (fmt === 'json') return pickArray(await res.json(), config.path);
      const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: 'array', cellDates: true });
      const ws = wb.Sheets[config.sheet ?? wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json(ws, { defval: null }) as Rows;
    }
    case 'postgres': {
      const { default: postgres } = await import('npm:postgres@3.4.5');
      const sql = postgres(secret?.url ?? config.url, { max: 1, idle_timeout: 5, connect_timeout: 15, prepare: false });
      try { return (await sql.unsafe(config.query)) as unknown as Rows; } finally { await sql.end(); }
    }
    case 'mysql': {
      const mysql = await import('npm:mysql2@3.11.0/promise');
      const conn = await mysql.createConnection(secret?.url ?? config.url);
      try { const [rows] = await conn.query(config.query); return rows as Rows; } finally { await conn.end(); }
    }
    default:
      throw new Error(`unknown connector kind ${kind}`);
  }
}

async function sync(db0: ReturnType<typeof admin>, connectorId: string, ws?: string) {
  let q0 = db0.from('connectors').select('*').eq('id', connectorId);
  if (ws) q0 = q0.eq('workspace_id', ws);
  const { data: c, error } = await q0.single();
  if (error) throw error;
  const db = admin(c.workspace_id); // наборы данных создаются в воркспейсе коннектора
  const { data: sec } = await db.from('connector_secrets').select('secret').eq('connector_id', connectorId).maybeSingle();
  try {
    const raw = await fetchRows(c.kind, c.config, sec?.secret);
    if (!raw.length) throw new Error('Źródło nie zwróciło żadnych wierszy');
    const inf = inferTable(raw.slice(0, MAX_ROWS));
    let wasActive = false;
    let datasetId: string | null = c.dataset_id;

    if (datasetId && c.mode === 'append') {
      for (const part of chunks(inf.rows, 3000)) {
        const { error: e } = await db.rpc('ds_insert', { p_id: datasetId, p_rows: part });
        if (e) throw e;
      }
    } else {
      if (datasetId) {
        const { data: old } = await db.from('datasets').select('is_active').eq('id', datasetId).maybeSingle();
        wasActive = !!old?.is_active;
        await db.rpc('ds_drop', { p_id: datasetId });
      }
      const { data: id, error: e1 } = await db.rpc('ds_create', {
        p_name: c.name, p_columns: inf.columns, p_roles: inf.roles, p_source: c.kind, p_connector: c.id,
        p_meta: { notes: inf.meta.notes, period: inf.meta.period, connector: c.name, synced_at: new Date().toISOString() },
      });
      if (e1) throw e1;
      datasetId = id as string;
      for (const part of chunks(inf.rows, 3000)) {
        const { error: e } = await db.rpc('ds_insert', { p_id: datasetId, p_rows: part });
        if (e) throw e;
      }
    }
    const { error: e2 } = await db.rpc('ds_finalize', { p_id: datasetId });
    if (e2) throw e2;
    if (wasActive) await db.rpc('ds_set_active', { p_id: datasetId });
    await db.from('connectors').update({ dataset_id: datasetId, last_sync_at: new Date().toISOString(), last_status: 'ok', last_error: null }).eq('id', c.id);
    return { dataset_id: datasetId, rows: inf.rows.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : JSON.stringify(e);
    await db.from('connectors').update({ last_sync_at: new Date().toISOString(), last_status: 'error', last_error: msg.slice(0, 500) }).eq('id', c.id);
    throw new Error(msg);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  const db = admin();

  // плановая синхронизация (pg_cron → pg_net)
  if (body.action === 'cron') {
    const secret = Deno.env.get('CRON_SECRET');
    if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'forbidden' }, 403);
    const { data: list } = await db.from('connectors').select('id, schedule_minutes, last_sync_at').not('schedule_minutes', 'is', null);
    const due = (list ?? []).filter((c) => !c.last_sync_at || Date.now() - new Date(c.last_sync_at).getTime() >= c.schedule_minutes * 60e3 - 30e3);
    const out = [];
    for (const c of due) { try { out.push(await sync(db, c.id)); } catch (e) { out.push({ id: c.id, error: String(e) }); } }
    return json({ synced: out });
  }

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const ws = await requireWorkspace(req, user);
  if (!ws) return json({ error: 'Brak dostępu do tego workspace' }, 403);
  try {
    if (body.action === 'test') {
      const raw = await fetchRows(body.kind, body.config ?? {}, body.secret ?? {});
      const inf = inferTable(raw.slice(0, 2000));
      return json({ total: raw.length, columns: inf.columns, roles: inf.roles, preview: inf.rows.slice(0, 20) });
    }
    if (body.action === 'save') {
      // секреты (токены API, строки подключения) пишутся только сервером, в браузер не возвращаются
      const row = {
        name: String(body.name ?? 'Źródło'), kind: String(body.kind), config: body.config ?? {},
        schedule_minutes: body.schedule_minutes ? Number(body.schedule_minutes) : null, mode: body.mode === 'append' ? 'append' : 'replace',
      };
      const q = body.id ? db.from('connectors').update(row).eq('id', body.id).eq('workspace_id', ws).select('id').single() : db.from('connectors').insert({ ...row, workspace_id: ws }).select('id').single();
      const { data, error } = await q;
      if (error) throw error;
      if (body.secret && Object.keys(body.secret).length) {
        await db.from('connector_secrets').upsert({ connector_id: data.id, secret: body.secret });
      }
      return json({ id: data.id });
    }
    if (body.action === 'delete') {
      const { data: c } = await db.from('connectors').select('dataset_id').eq('id', body.id).eq('workspace_id', ws).maybeSingle();
      if (!c) return json({ error: 'not found' }, 404);
      if (c.dataset_id && body.with_data) await admin(ws).rpc('ds_drop', { p_id: c.dataset_id });
      await db.from('connectors').delete().eq('id', body.id).eq('workspace_id', ws);
      return json({ ok: true });
    }
    if (body.action === 'sync') return json(await sync(db, String(body.id), ws));
    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
