// Общие функции для текста документов (браузер и локальный импорт).

/** Делит текст на куски ~1800 знаков по границам абзацев/предложений. */
export function chunkText(text: string, size = 1800): string[] {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  if (!clean) return [];
  const out: string[] = [];
  let cur = '';
  for (const para of clean.split(/\n\n/)) {
    const parts = para.length > size ? para.match(new RegExp(`[\\s\\S]{1,${size}}(?:\\s|$)`, 'g')) ?? [para] : [para];
    for (const p of parts) {
      if (cur && cur.length + p.length + 2 > size) { out.push(cur.trim()); cur = ''; }
      cur += (cur ? '\n\n' : '') + p;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.slice(0, 400); // до ~700 тыс. знаков на документ
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** XML Office (docx/pptx) → текст: абзацы и текстовые узлы. */
export function officeXmlToText(xml: string, paraTag: string, textTag: string): string {
  const paras = xml.split(new RegExp(`</${paraTag}>`));
  const re = new RegExp(`<${textTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${textTag}>`, 'g');
  const dec = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  return paras.map((p) => { let t = ''; let m: RegExpExecArray | null; re.lastIndex = 0; while ((m = re.exec(p))) t += m[1]; return dec(t).trim(); })
    .filter(Boolean).join('\n');
}

export const isVideo = (name: string, mime = '') => /^video\//.test(mime) || /\.(mp4|mov|avi|mkv|webm|m4v)$/i.test(name);
export const isAudio = (name: string, mime = '') => /^audio\//.test(mime) || /\.(mp3|wav|m4a|ogg|aac)$/i.test(name);
export const isImage = (name: string, mime = '') => /^image\//.test(mime) || /\.(jpe?g|png|webp|gif|bmp|tiff?|heic)$/i.test(name);
export const extOf = (name: string) => (name.match(/\.([a-z0-9]{1,6})$/i)?.[1] ?? '').toLowerCase();
