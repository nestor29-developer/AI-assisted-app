export type FileKind = 'text' | 'markdown' | 'pdf';

export interface UploadedFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface ExtractionLimits {
  readonly maxPdfPages: number;
  readonly parseTimeoutMs: number;
}

export interface ExtractedContent {
  /** One entry per page for PDFs; null for plain text. */
  readonly pages: readonly string[] | null;
  readonly text: string;
  readonly pageCount: number | null;
}

export interface TextExtractor {
  extract(bytes: Uint8Array, limits: ExtractionLimits): Promise<ExtractedContent>;
}

export const MIME_TYPES: Readonly<Record<FileKind, string>> = {
  text: 'text/plain',
  markdown: 'text/markdown',
  pdf: 'application/pdf',
};
