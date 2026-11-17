// Разбор файла в отдельном потоке: SheetJS + распознавание структуры.
import * as XLSX from 'xlsx';
import { inferTable, pickArray } from './infer';

let wb: XLSX.WorkBook | null = null;
let jsonRows: Record<string, unknown>[] | null = null;

self.onmessage = (e: MessageEvent) => {
  const { type, buf, name, sheet } = e.data as { type: 'open' | 'sheet'; buf?: ArrayBuffer; name?: string; sheet?: string };
  try {
    if (type === 'open') {
      wb = null; jsonRows = null;
      if (/\.json$/i.test(name ?? '')) {
        jsonRows = pickArray(JSON.parse(new TextDecoder().decode(buf)));
        const inf = inferTable(jsonRows);
        (self as any).postMessage({ ok: true, sheets: ['JSON'], sheet: 'JSON', inferred: inf });
        return;
      }
      wb = XLSX.read(new Uint8Array(buf!), { type: 'array', cellDates: true, dense: true });
      // лист с наибольшим числом строк — по умолчанию
      const sizes = wb.SheetNames.map((n) => { const r = wb!.Sheets[n]['!ref']; return r ? XLSX.utils.decode_range(r).e.r : 0; });
      const best = wb.SheetNames[sizes.indexOf(Math.max(...sizes))];
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[best], { defval: null, raw: true }) as Record<string, unknown>[];
      (self as any).postMessage({ ok: true, sheets: wb.SheetNames, sheet: best, inferred: inferTable(raw) });
    } else if (type === 'sheet' && wb && sheet) {
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: null, raw: true }) as Record<string, unknown>[];
      (self as any).postMessage({ ok: true, sheets: wb.SheetNames, sheet, inferred: inferTable(raw) });
    }
  } catch (err) {
    (self as any).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
