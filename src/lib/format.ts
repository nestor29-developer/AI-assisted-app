import type { DocumentSummary } from '@/shared/contracts/documents';

const DAY_MS = 86_400_000;

export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** How long until a document is deleted automatically, in words. */
export function formatExpiry(expiresAtIso: string, now: Date = new Date()): string {
  const days = Math.ceil((Date.parse(expiresAtIso) - now.getTime()) / DAY_MS);
  if (Number.isNaN(days) || days < 0) return 'Expired';
  if (days === 0) return 'Deletes today';
  if (days === 1) return 'Deletes tomorrow';
  return `Deletes in ${days} days`;
}

const pluralize = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** "PDF, 12 pages" or "Markdown file" or "Pasted text": what the document came from. */
export function describeKind({ sourceType, mimeType, pageCount }: DocumentSummary): string {
  if (sourceType === 'text') return 'Pasted text';
  if (mimeType === 'application/pdf')
    return pageCount ? `PDF, ${pluralize(pageCount, 'page')}` : 'PDF';
  return mimeType === 'text/markdown' ? 'Markdown file' : 'Text file';
}

export function formatDuration(ms: number): string {
  return ms < 1_000 ? `${ms} ms` : `${(ms / 1_000).toFixed(1)} s`;
}

export const formatTokens = (count: number): string => count.toLocaleString('en-US');
