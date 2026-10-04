import type { DocumentSummary } from '@/shared/contracts/documents';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const pluralize = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  const kilobytes = Math.round(bytes / 1_000);
  // 999,999 bytes rounds up to 1000 KB, which is a megabyte.
  if (kilobytes < 1_000) return `${kilobytes} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** How long until a document is deleted automatically, in words; the time left decides, not the calendar. */
export function formatExpiry(expiresAtIso: string, now: Date = new Date()): string {
  const remaining = Date.parse(expiresAtIso) - now.getTime();
  if (Number.isNaN(remaining) || remaining <= 0) return 'Expired';
  if (remaining < HOUR_MS) return 'Auto-deletes within the hour';
  if (remaining < DAY_MS) {
    return `Auto-deletes in ${pluralize(Math.floor(remaining / HOUR_MS), 'hour')}`;
  }
  return `Auto-deletes in ${pluralize(Math.max(1, Math.round(remaining / DAY_MS)), 'day')}`;
}

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

/** Flattens whitespace and cuts to at most `max` characters, at a word where that keeps most of it. */
export function ellipsize(text: string, max: number): string {
  const characters = Array.from(text.replace(/\s+/g, ' ').trim());
  if (characters.length <= max) return characters.join('');
  const cut = characters.slice(0, max - 1).join('');
  const atWord = cut.replace(/\s+\S*$/, '');
  return `${(atWord.length >= max / 2 ? atWord : cut).trimEnd()}…`;
}
