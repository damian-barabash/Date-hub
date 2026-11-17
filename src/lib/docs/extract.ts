// Чтение любых файлов прямо в браузере. На сервер уходит только текст.
// PDF (текст, а сканы — распознавание), Word, PowerPoint, Excel/CSV, текстовые файлы, zip-архивы,
// картинки-документы (распознавание текста). Видео, аудио и обычные фото без текста пропускаются.
import { chunkText, extOf, isAudio, isImage, isVideo, officeXmlToText } from './text';

export interface Extracted { title: string; path: string; ext: string; size: number; text: string; pages?: number; ocr: boolean }
export interface Skipped { title: string; reason: string }
export type Progress = (msg: string) => void;

const MIN_PHOTO_TEXT = 60;     // меньше знаков на картинке → это обычное фото, не документ
const OCR_PAGE_LIMIT = 40;

let ocrWorker: Promise<any> | null = null;
async function ocr(image: Blob | HTMLCanvasElement): Promise<string> {
  ocrWorker ??= (async () => { const T = await import('tesseract.js'); return T.createWorker(['pol', 'eng']); })();
  const w = await ocrWorker;
  const { data } = await w.recognize(image);
  // отбрасываем «мусор» с низкой уверенностью (фото без текста дают случайные символы)
  return data.confidence < 45 ? '' : String(data.text ?? '').trim();
}
export async function stopOcr() { if (ocrWorker) { const w = await ocrWorker; await w.terminate(); ocrWorker = null; } }

async function pdfText(buf: ArrayBuffer, onp: Progress): Promise<{ text: string; pages: number; ocr: boolean }> {
  const pdfjs: any = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    let last: number | null = null; let line = ''; const lines: string[] = [];
    for (const it of tc.items as any[]) {
      const y = Math.round(it.transform?.[5] ?? 0);
      if (last !== null && Math.abs(y - last) > 2) { lines.push(line); line = ''; }
      line += (line && !line.endsWith(' ') ? ' ' : '') + it.str; last = y;
    }
    if (line) lines.push(line);
    pages.push(lines.join('\n'));
  }
  let text = pages.join('\n\n');
  let usedOcr = false;
  // скан: текста почти нет → рисуем страницы и распознаём
  if (text.replace(/\s/g, '').length < 40 * pdf.numPages) {
    usedOcr = true; const out: string[] = [];
    for (let i = 1; i <= Math.min(pdf.numPages, OCR_PAGE_LIMIT); i++) {
      onp(`OCR ${i}/${Math.min(pdf.numPages, OCR_PAGE_LIMIT)}`);
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas'); canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
      out.push(await ocr(canvas));
    }
    text = out.join('\n\n');
  }
  return { text, pages: pdf.numPages, ocr: usedOcr };
}

async function zipEntries(buf: ArrayBuffer) {
  const JSZip = (await import('jszip')).default;
  return JSZip.loadAsync(buf);
}

async function docxText(buf: ArrayBuffer): Promise<string> {
  const zip = await zipEntries(buf);
  const names = Object.keys(zip.files).filter((n) => /^word\/(document|footnotes|header\d*|footer\d*)\.xml$/.test(n)).sort((a) => (a.includes('document') ? -1 : 1));
  const parts = await Promise.all(names.map((n) => zip.files[n].async('string')));
  return parts.map((x) => officeXmlToText(x, 'w:p', 'w:t')).filter(Boolean).join('\n\n');
}
async function pptxText(buf: ArrayBuffer): Promise<{ text: string; pages: number }> {
  const zip = await zipEntries(buf);
  const num = (n: string) => Number(n.match(/(\d+)\.xml$/)?.[1] ?? 0);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  const out: string[] = [];
  for (const s of slides) {
    const body = officeXmlToText(await zip.files[s].async('string'), 'a:p', 'a:t');
    const note = zip.files[`ppt/notesSlides/notesSlide${num(s)}.xml`];
    const notes = note ? officeXmlToText(await note.async('string'), 'a:p', 'a:t') : '';
    out.push(`[Slajd ${num(s)}]\n${body}${notes ? `\n(notatki) ${notes}` : ''}`);
  }
  return { text: out.join('\n\n'), pages: slides.length };
}
async function sheetText(buf: ArrayBuffer): Promise<{ text: string; pages: number }> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
  const out: string[] = [];
  for (const n of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: ' | ', blankrows: false }).split('\n').map((l) => l.replace(/( \| )+$/g, '').trim()).filter((l) => l.replace(/[| ]/g, '')).join('\n');
    if (csv) out.push(`[Arkusz: ${n}]\n${csv.slice(0, 120_000)}`);
  }
  return { text: out.join('\n\n'), pages: wb.SheetNames.length };
}

/** Один файл → 0..n документов (архив раскрывается). */
export async function extractFile(file: File, path = '', onp: Progress = () => {}): Promise<{ docs: Extracted[]; skipped: Skipped[] }> {
  const name = file.name; const ext = extOf(name);
  const base = { title: name, path, ext, size: file.size };
  const skip = (reason: string) => ({ docs: [], skipped: [{ title: name, reason }] });
  if (/^(\._|\.DS_Store|Icon)/.test(name) || path.includes('__MACOSX')) return { docs: [], skipped: [] };
  if (isVideo(name, file.type)) return skip('wideo — pominięte');
  if (isAudio(name, file.type)) return skip('audio — pominięte');
  try {
    if (ext === 'zip') {
      const zip = await zipEntries(await file.arrayBuffer());
      const docs: Extracted[] = []; const skipped: Skipped[] = [];
      for (const [n, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const blob = await entry.async('blob');
        const inner = new File([blob], n.split('/').pop() ?? n);
        const dir = [path, name.replace(/\.zip$/i, ''), ...n.split('/').slice(0, -1)].filter(Boolean).join('/');
        const r = await extractFile(inner, dir, onp);
        docs.push(...r.docs); skipped.push(...r.skipped);
      }
      return { docs, skipped };
    }
    if (ext === 'rar' || ext === '7z') return skip('archiwum RAR/7z — rozpakuj i wgraj pliki');
    if (ext === 'pdf') {
      const r = await pdfText(await file.arrayBuffer(), onp);
      return r.text.trim().length > 20 ? { docs: [{ ...base, ...r }], skipped: [] } : skip('PDF bez czytelnego tekstu');
    }
    if (ext === 'docx') return { docs: [{ ...base, text: await docxText(await file.arrayBuffer()), ocr: false }], skipped: [] };
    if (ext === 'pptx') { const r = await pptxText(await file.arrayBuffer()); return { docs: [{ ...base, ...r, ocr: false }], skipped: [] }; }
    if (['xlsx', 'xls', 'xlsm', 'ods', 'csv', 'tsv'].includes(ext)) { const r = await sheetText(await file.arrayBuffer()); return { docs: [{ ...base, ...r, ocr: false }], skipped: [] }; }
    if (['txt', 'md', 'json', 'xml', 'html', 'htm', 'rtf', 'eml', 'log'].includes(ext)) {
      let t = await file.text();
      if (ext === 'html' || ext === 'htm' || ext === 'xml') t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
      if (ext === 'rtf') t = t.replace(/\\'[0-9a-f]{2}/gi, '').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
      return { docs: [{ ...base, text: t, ocr: false }], skipped: [] };
    }
    if (isImage(name, file.type)) {
      if (ext === 'heic') return skip('HEIC — zapisz jako JPG');
      onp('OCR');
      const t = await ocr(file);
      return t.replace(/\s/g, '').length >= MIN_PHOTO_TEXT ? { docs: [{ ...base, text: t, pages: 1, ocr: true }], skipped: [] } : skip('zdjęcie bez tekstu — pominięte');
    }
    if (ext === 'doc' || ext === 'ppt') return skip('stary format Office — zapisz jako DOCX/PPTX lub PDF');
    return skip('nieobsługiwany format');
  } catch (e) {
    return skip(`błąd odczytu: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export { chunkText };
