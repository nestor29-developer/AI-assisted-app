import { z } from 'zod';

export const DOCUMENT_TITLE_MAX = 200;

/** Server defaults, shared so the upload form can show them; the server enforces whatever is configured. */
export const DEFAULT_MAX_UPLOAD_MB = 10;
export const DEFAULT_MAX_PDF_PAGES = 100;

export const documentSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  sourceType: z.enum(['text', 'file']),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  /** Only PDFs have pages. */
  pageCount: z.number().int().positive().nullable(),
  chunkCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

export const createTextDocumentSchema = z.object({
  title: z.string().trim().min(1, 'Give the document a title.').max(DOCUMENT_TITLE_MAX),
  text: z.string().trim().min(1, 'Paste some text first.'),
});

export const documentResponseSchema = z.object({ document: documentSummarySchema });
export const documentListResponseSchema = z.object({ documents: z.array(documentSummarySchema) });

export const ACCEPTED_UPLOAD_EXTENSIONS = ['.txt', '.md', '.pdf'] as const;

export type DocumentSummary = z.infer<typeof documentSummarySchema>;
export type CreateTextDocument = z.output<typeof createTextDocumentSchema>;
