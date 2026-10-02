import { UnprocessableError, UnsupportedMediaTypeError } from '@/server/core/errors';

import { PdfExtractor } from './pdf';
import { PlainTextExtractor } from './plain-text';
import { MIME_TYPES, type FileKind, type TextExtractor, type UploadedFile } from './types';

export { MIME_TYPES } from './types';
export type { ExtractedContent, ExtractionLimits, FileKind, UploadedFile } from './types';

const PDF_MAGIC = new TextEncoder().encode('%PDF-');
/** The PDF header may be preceded by a few bytes of junk; readers accept it in the first KiB. */
const PDF_HEADER_WINDOW = 1024;

function hasPdfHeader(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, PDF_HEADER_WINDOW);
  for (let start = 0; start + PDF_MAGIC.length <= head.length; start += 1) {
    if (PDF_MAGIC.every((byte, offset) => head[start + offset] === byte)) return true;
  }
  return false;
}

/** The kind comes from the extension and the content, never from the client's declared MIME type. */
export function detectFileKind({ name, bytes }: UploadedFile): FileKind {
  const extension = /\.[a-z0-9]+$/i.exec(name)?.[0]?.toLowerCase();

  if (extension === '.pdf') {
    if (!hasPdfHeader(bytes)) {
      throw new UnprocessableError('DOCUMENT_REJECTED', 'This file is not a valid PDF.');
    }
    return 'pdf';
  }
  if (extension === '.txt' || extension === '.md') {
    if (hasPdfHeader(bytes)) {
      throw new UnprocessableError(
        'DOCUMENT_REJECTED',
        'This file is a PDF with the wrong extension.',
      );
    }
    return extension === '.md' ? 'markdown' : 'text';
  }
  throw new UnsupportedMediaTypeError('Only .txt, .md and .pdf files are supported.');
}

const EXTRACTORS: Readonly<Record<FileKind, TextExtractor>> = {
  text: new PlainTextExtractor(),
  markdown: new PlainTextExtractor(),
  pdf: new PdfExtractor(),
};

/** Strategy selection: one extractor per file kind behind a common port. */
export function extractorFor(kind: FileKind): TextExtractor {
  return EXTRACTORS[kind];
}

export const mimeTypeFor = (kind: FileKind): string => MIME_TYPES[kind];
