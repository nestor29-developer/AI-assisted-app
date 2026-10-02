import { describe, expect, it } from 'vitest';

import type { DocumentSummary } from '@/shared/contracts/documents';

import { describeKind, formatBytes, formatDuration, formatExpiry, formatTokens } from './format';

const NOW = new Date('2026-10-01T12:00:00Z');
const daysFromNow = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

const document = (overrides: Partial<DocumentSummary>): DocumentSummary => ({
  id: '00000000-0000-4000-8000-000000000000',
  title: 'Handbook',
  sourceType: 'file',
  mimeType: 'text/plain',
  sizeBytes: 100,
  pageCount: null,
  chunkCount: 1,
  createdAt: NOW.toISOString(),
  expiresAt: daysFromNow(30),
  ...overrides,
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [999, '999 B'],
    [1_000, '1 KB'],
    [48_400, '48 KB'],
    [999_999, '1000 KB'],
    [1_000_000, '1.0 MB'],
    [10_485_760, '10.5 MB'],
  ])('formats %i bytes as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('formatExpiry', () => {
  it.each([
    [30, 'Deletes in 30 days'],
    [2, 'Deletes in 2 days'],
    [1, 'Deletes tomorrow'],
    [0.4, 'Deletes tomorrow'],
    [0, 'Deletes today'],
    [-1, 'Expired'],
  ])('describes %s days away as "%s"', (days, expected) => {
    expect(formatExpiry(daysFromNow(days), NOW)).toBe(expected);
  });

  it('treats an unreadable date as expired instead of showing NaN', () => {
    expect(formatExpiry('not a date', NOW)).toBe('Expired');
  });
});

describe('describeKind', () => {
  it.each([
    [{ sourceType: 'text' as const }, 'Pasted text'],
    [{ mimeType: 'application/pdf', pageCount: 12 }, 'PDF, 12 pages'],
    [{ mimeType: 'application/pdf', pageCount: 1 }, 'PDF, 1 page'],
    [{ mimeType: 'application/pdf', pageCount: null }, 'PDF'],
    [{ mimeType: 'text/markdown' }, 'Markdown file'],
    [{ mimeType: 'text/plain' }, 'Text file'],
  ])('describes %j as "%s"', (overrides, expected) => {
    expect(describeKind(document(overrides))).toBe(expected);
  });
});

describe('formatDuration and formatTokens', () => {
  it('uses milliseconds below a second and seconds above', () => {
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(1_250)).toBe('1.3 s');
    expect(formatDuration(12_000)).toBe('12.0 s');
  });

  it('groups thousands', () => {
    expect(formatTokens(1_234_567)).toBe('1,234,567');
    expect(formatTokens(12)).toBe('12');
  });
});
