// Локальный импорт папки документов: текст извлекается на этом компьютере, на сервер уходит только текст.
// DH_LOGIN=… DH_PASSWORD=… node scripts/import-folder.mts <dir> [manifest.json]
//   manifest (необязателен): [{id, title, path, viewUrl, ext}] — файлы лежат как <dir>/<id>.<ext>; без него обходится сама папка.
// Нужны: pdftotext, pdftoppm (poppler), tesseract с польским языком (TESSDATA_PREFIX).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative } from 'node:path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { chunkText, isAudio, isImage, isVideo, officeXmlToText } from '../src/lib/docs/text.ts';

const [dir, manifestPath] = process.argv.slice(2);
if (!dir) { console.error('usage: import-folder.mts <dir> [manifest.json]'); process.exit(1); }
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_KEY);
const login = process.env.DH_LOGIN ?? ''; 
const { error: le } = await sb.auth.signInWithPassword({ email: login.includes('@') ? login : `${login.toLowerCase()}@datehub.infinitiq.pl`, password: process.env.DH_PASSWORD ?? '' });
if (le) { console.error('login failed:', le.message); process.exit(1); }

const sh = (cmd: string, args: string[], opts: object = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], ...opts });
const ocrImage = (file: string): string => { try { return sh('tesseract', [file, '-', '-l', 'pol+eng', '--psm', '3'], { timeout: 120_000 }).trim(); } catch { return ''; } };

function pdf(file: string): { text: string; pages: number; ocr: boolean } {
  let text = ''; let pages = 0;
  try { text = sh('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { timeout: 120_000 }); } catch { /* повреждён или защищён */ }
  try { pages = Number(sh('pdfinfo', [file]).match(/Pages:\s+(\d+)/)?.[1] ?? 0); } catch { /* ignore */ }
  if (text.replace(/\s/g, '').length >= 40 * Math.max(pages, 1)) return { text, pages, ocr: false };
  // скан → картинки страниц → распознавание
  const tmp = mkdtempSync(join(tmpdir(), 'dh-ocr-'));
  try {
    sh('pdftoppm', ['-r', '170', '-png', '-l', '40', file, join(tmp, 'p')], { timeout: 300_000 });
    const out = readdirSync(tmp).sort().map((f) => ocrImage(join(tmp, f)));
    return { text: out.join('\n\n'), pages, ocr: true };
  } catch { return { text, pages, ocr: false }; } finally { rmSync(tmp, { recursive: true, force: true }); }
}
async function docx(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => /^word\/(document|footnotes|header\d*|footer\d*)\.xml$/.test(n)).sort((a) => (a.includes('document') ? -1 : 1));
  return (await Promise.all(names.map((n) => zip.files[n].async('string')))).map((x) => officeXmlToText(x, 'w:p', 'w:t')).filter(Boolean).join('\n\n');
}
async function pptx(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const num = (n: string) => Number(n.match(/(\d+)\.xml$/)?.[1] ?? 0);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  const out: string[] = [];
  for (const s of slides) {
    const note = zip.files[`ppt/notesSlides/notesSlide${num(s)}.xml`];
    out.push(`[Slajd ${num(s)}]\n${officeXmlToText(await zip.files[s].async('string'), 'a:p', 'a:t')}${note ? `\n(notatki) ${officeXmlToText(await note.async('string'), 'a:p', 'a:t')}` : ''}`);
  }
  return { text: out.join('\n\n'), pages: slides.length };
}
function sheet(buf: Buffer) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const out: string[] = [];
  for (const n of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: ' | ', blankrows: false }).split('\n').map((l) => l.replace(/( \| )+$/g, '').trim()).filter((l) => l.replace(/[| ]/g, '')).join('\n');
    if (csv) out.push(`[Arkusz: ${n}]\n${csv.slice(0, 120_000)}`);
  }
  return { text: out.join('\n\n'), pages: wb.SheetNames.length };
}

interface Out { title: string; path: string; ext: string; size: number; text: string; pages?: number; ocr: boolean }
const stats = { saved: 0, skipped: [] as string[], chars: 0, ocr: 0 };

async function extract(file: string, title: string, path: string): Promise<Out[]> {
  const ext = extname(title).slice(1).toLowerCase(); const size = statSync(file).size;
  const base = { title, path, ext, size };
  const skip = (why: string) => { stats.skipped.push(`${path}/${title} — ${why}`); return []; };
  if (/^(\._|\.DS_Store|Icon)/.test(title) || path.includes('__MACOSX')) return [];
  if (isVideo(title) || isAudio(title)) return skip('wideo/audio');
  try {
    if (ext === 'pdf') { const r = pdf(file); return r.text.trim().length > 20 ? [{ ...base, ...r }] : skip('PDF bez tekstu'); }
    if (ext === 'docx') return [{ ...base, text: await docx(readFileSync(file)), ocr: false }];
    if (ext === 'pptx') return [{ ...base, ...(await pptx(readFileSync(file))), ocr: false }];
    if (['xlsx', 'xls', 'xlsm', 'ods', 'csv', 'tsv'].includes(ext)) return [{ ...base, ...sheet(readFileSync(file)), ocr: false }];
    if (['txt', 'md', 'json', 'xml', 'html', 'htm', 'eml'].includes(ext)) return [{ ...base, text: readFileSync(file, 'utf8').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(ext === 'txt' || ext === 'md' ? /$^/ : /<[^>]+>/g, ' '), ocr: false }];
    if (isImage(title)) { const t = ocrImage(file); return t.replace(/\s/g, '').length >= 60 ? [{ ...base, text: t, pages: 1, ocr: true }] : skip('zdjęcie bez tekstu'); }
    if (ext === 'zip' || ext === 'rar') {
      const tmp = mkdtempSync(join(tmpdir(), 'dh-zip-'));
      try {
        sh('bsdtar', ['-xf', file, '-C', tmp], { timeout: 300_000 });
        const out: Out[] = [];
        for (const f of walk(tmp)) out.push(...(await extract(f, basename(f), [path, title.replace(/\.(zip|rar)$/i, ''), relative(tmp, join(f, '..'))].filter(Boolean).join('/'))));
        return out;
      } catch { return skip('nie udało się rozpakować archiwum'); } finally { rmSync(tmp, { recursive: true, force: true }); }
    }
    return skip(`nieobsługiwany format .${ext}`);
  } catch (e) { return skip(`błąd: ${e instanceof Error ? e.message : e}`); }
}
function* walk(d: string): Generator<string> {
  for (const n of readdirSync(d).sort()) { const p = join(d, n); if (statSync(p).isDirectory()) yield* walk(p); else yield p; }
}

async function save(d: Out, sourceUrl: string | null) {
  const chunks = chunkText(d.text);
  if (!chunks.length) { stats.skipped.push(`${d.path}/${d.title} — pusty tekst`); return; }
  const hash = createHash('sha256').update(`${d.title}|${d.text.length}|${d.text.slice(0, 4000)}`).digest('hex');
  const { error } = await sb.rpc('doc_upsert', { p_doc: { title: d.title, path: d.path, ext: d.ext, size: d.size, source: 'drive', source_url: sourceUrl, hash, pages: d.pages ?? null, ocr: d.ocr }, p_chunks: chunks });
  if (error) { stats.skipped.push(`${d.path}/${d.title} — zapis: ${error.message}`); return; }
  stats.saved++; stats.chars += d.text.length; if (d.ocr) stats.ocr++;
}

const t0 = Date.now();
if (manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { id: string; title: string; path: string; viewUrl?: string; ext?: string }[];
  const onDisk = readdirSync(dir);
  let i = 0;
  for (const m of manifest) {
    const f = onDisk.find((n) => n.startsWith(m.id + '.'));
    if (!f) { stats.skipped.push(`${m.path}/${m.title} — nie pobrano`); continue; }
    // Google-документы и названия вида «… 08.08.2026» получают расширение файла на диске
    const title = /\.(pdf|docx?|pptx?|pptm|xlsx?|xlsm|ods|csv|tsv|zip|rar|txt|md|json|xml|html?|eml|msg|jpe?g|png)$/i.test(m.title) ? m.title : `${m.title}${extname(f)}`;
    for (const d of await extract(join(dir, f), title, m.path)) await save(d, m.viewUrl ?? null);
    if (++i % 20 === 0) console.log(`${i}/${manifest.length} · zapisano ${stats.saved} · ${Math.round((Date.now() - t0) / 1000)}s`);
  }
} else {
  for (const f of walk(dir)) for (const d of await extract(f, basename(f), relative(dir, join(f, '..')))) await save(d, null);
}
console.log(JSON.stringify({ saved: stats.saved, ocr: stats.ocr, chars: stats.chars, skipped: stats.skipped.length, seconds: Math.round((Date.now() - t0) / 1000) }));
if (stats.skipped.length) console.log('POMINIĘTE:\n' + stats.skipped.join('\n'));
