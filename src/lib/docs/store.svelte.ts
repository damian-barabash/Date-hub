// Состояние документов: сводка (для меню и ИИ), сохранение текста, запуск разбора ИИ.
import { supabase, fn } from '../supabase';
import { chunkText, sha256Hex } from './text';
import type { Extracted } from './extract';

export interface DocStats { total: number; pending: number; min_date: string | null; max_date: string | null; cats: { category: string; n: number; gross: number | null }[]; types: { doc_type: string; n: number }[] }
export interface Doc {
  id: string; title: string; path: string; ext: string | null; size: number | null; source: string; source_url: string | null;
  category: string | null; doc_type: string | null; summary: string | null; doc_date: string | null; counterparty: string | null; number: string | null;
  net: number | null; vat: number | null; gross: number | null; currency: string | null; meta: { topics?: string[] }; pages: number | null; chars: number; ocr: boolean; status: string; created_at: string;
}

export const docs = $state({ stats: null as DocStats | null, analyzing: false, progress: '' });

export async function loadDocStats() {
  const { data } = await supabase.rpc('doc_stats');
  docs.stats = (data ?? null) as DocStats | null;
  return docs.stats;
}

/** Сохраняет текст документа; возвращает id. Повторная загрузка того же текста не создаёт дубль. */
export async function saveDoc(d: Extracted, source = 'upload', sourceUrl: string | null = null): Promise<string | null> {
  const chunks = chunkText(d.text);
  if (!chunks.length) return null;
  const hash = await sha256Hex(`${d.title}|${d.text.length}|${d.text.slice(0, 4000)}`);
  const { data, error } = await supabase.rpc('doc_upsert', {
    p_doc: { title: d.title, path: d.path, ext: d.ext, size: d.size, source, source_url: sourceUrl, hash, pages: d.pages ?? null, ocr: d.ocr },
    p_chunks: chunks,
  });
  if (error) throw error;
  return data as string;
}

/** ИИ раскладывает новые документы по вкладкам и вытягивает поля. Вызывается, пока есть необработанные. */
export async function analyzeAll(onProgress?: (left: number) => void) {
  if (docs.analyzing) return;
  docs.analyzing = true;
  try {
    for (let i = 0; i < 400; i++) {
      const r = await fn<{ done: number; failed: number; remaining: number }>('docs', { action: 'analyze', limit: 8 });
      docs.progress = String(r.remaining); onProgress?.(r.remaining);
      if (!r.remaining || (!r.done && !r.failed)) break;
    }
  } finally {
    docs.analyzing = false; docs.progress = '';
    await loadDocStats();
  }
}

/** Адрес вкладки категории (название → безопасный фрагмент URL). */
export const catHref = (c: string) => `/docs/c/${encodeURIComponent(c)}`;
