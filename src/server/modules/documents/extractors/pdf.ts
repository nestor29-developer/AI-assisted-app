import { extractText, getDocumentProxy } from 'unpdf';

import { UnprocessableError } from '@/server/core/errors';

import type { ExtractedContent, ExtractionLimits, TextExtractor } from './types';

/** Below this much text per page on average, the PDF is almost certainly scanned images. */
const MIN_CHARS_PER_PAGE = 20;
const MIN_TOTAL_CHARS = 50;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new UnprocessableError('DOCUMENT_REJECTED', 'The PDF took too long to read.')),
      ms,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const unreadable = () =>
  new UnprocessableError(
    'DOCUMENT_REJECTED',
    'The PDF could not be read. It may be damaged or encrypted.',
  );

/** Reads the text of each page with pdf.js (via unpdf); a separate function so tests can swap it. */
export async function readPdfPages(bytes: Uint8Array, maxPages: number): Promise<string[]> {
  // pdf.js takes ownership of the buffer it is given, so hand it a copy (and keep it quiet).
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  try {
    if (pdf.numPages > maxPages) {
      throw new UnprocessableError(
        'DOCUMENT_REJECTED',
        `The PDF has ${pdf.numPages} pages; the limit is ${maxPages}.`,
      );
    }
    const { text } = await extractText(pdf, { mergePages: false });
    return text;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

type PageReader = (bytes: Uint8Array, maxPages: number) => Promise<string[]>;

/** Text-layer extraction only: scanned PDFs are refused with a clear message, not silently indexed empty. */
export class PdfExtractor implements TextExtractor {
  constructor(private readonly readPages: PageReader = readPdfPages) {}

  async extract(bytes: Uint8Array, limits: ExtractionLimits): Promise<ExtractedContent> {
    let pages: string[];
    try {
      pages = await withTimeout(this.readPages(bytes, limits.maxPdfPages), limits.parseTimeoutMs);
    } catch (error) {
      throw error instanceof UnprocessableError ? error : unreadable();
    }

    const meaningful = pages.reduce((sum, page) => sum + page.replace(/\s+/g, '').length, 0);
    if (meaningful < Math.max(MIN_TOTAL_CHARS, MIN_CHARS_PER_PAGE * pages.length)) {
      throw new UnprocessableError(
        'PDF_NO_TEXT_LAYER',
        'This PDF has no selectable text (it looks scanned). Upload a text-based PDF instead.',
      );
    }
    return { pages, text: pages.join('\f'), pageCount: pages.length };
  }
}
