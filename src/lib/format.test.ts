import { describe, expect, it } from 'vitest';

import type { DocumentSummary } from '@/shared/contracts/documents';

import {
  describeKind,
  ellipsize,
  formatBytes,
  formatDuration,
  formatExpiry,
  formatTokens,
} from './format';

const NOW = new Date('2026-10-01T12:00:00Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const after = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

const document = (overrides: Partial<DocumentSummary>): DocumentSummary => ({
  id: '00000000-0000-4000-8000-000000000000',
  title: 'Handbook',
  sourceType: 'file',
  mimeType: 'text/plain',
  sizeBytes: 100,
  pageCount: null,
  chunkCount: 1,
  createdAt: NOW.toISOString(),
  expiresAt: after(30 * DAY),
  ...overrides,
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [999, '999 B'],
    [1_000, '1 KB'],
    [48_400, '48 KB'],
    [999_499, '999 KB'],
    [999_500, '1.0 MB'],
    [999_999, '1.0 MB'],
    [1_000_000, '1.0 MB'],
    [10_485_760, '10.5 MB'],
  ])('formats %i bytes as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('formatExpiry', () => {
  it.each([
    [30 * DAY, 'Auto-deletes in 30 days'],
    [30 * DAY - 5_000, 'Auto-deletes in 30 days'],
    [2 * DAY, 'Auto-deletes in 2 days'],
    [DAY, 'Auto-deletes in 1 day'],
    [DAY + HOUR, 'Auto-deletes in 1 day'],
    [DAY - MINUTE, 'Auto-deletes in 23 hours'],
    [9 * HOUR + 36 * MINUTE, 'Auto-deletes in 9 hours'],
    [2 * HOUR, 'Auto-deletes in 2 hours'],
    [HOUR, 'Auto-deletes in 1 hour'],
    [HOUR - MINUTE, 'Auto-deletes within the hour'],
    [MINUTE, 'Auto-deletes within the hour'],
  ])('describes %i ms away as "%s"', (ms, expected) => {
    expect(formatExpiry(after(ms), NOW)).toBe(expected);
  });

  it('never calls a document that is already gone something that will be deleted', () => {
    expect(formatExpiry(after(0), NOW)).toBe('Expired');
    expect(formatExpiry(after(-MINUTE), NOW)).toBe('Expired');
    expect(formatExpiry(after(-2 * HOUR), NOW)).toBe('Expired');
    expect(formatExpiry(after(-DAY), NOW)).toBe('Expired');
  });

  it('does not say "tomorrow" for a document with hours left, nor "today" for an expired one', () => {
    for (const ms of [-2 * HOUR, 0, 2 * HOUR, 20 * HOUR, 2 * DAY]) {
      expect(formatExpiry(after(ms), NOW)).not.toMatch(/tomorrow|today/);
    }
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

describe('ellipsize', () => {
  it('leaves short text alone and flattens its whitespace', () => {
    expect(ellipsize('  How many\n days?  ', 40)).toBe('How many days?');
  });

  it('cuts long text at a word and ends it with an ellipsis, within the limit', () => {
    const cut = ellipsize('How many vacation days do employees accrue per month in total?', 30);

    expect(cut).toBe('How many vacation days do…');
    expect([...cut].length).toBeLessThanOrEqual(30);
  });

  it('cuts a single long word where it has to', () => {
    expect(ellipsize('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('never splits a character that takes two code units', () => {
    const cut = ellipsize('\u{1F389}'.repeat(30), 10);

    expect(cut.isWellFormed()).toBe(true);
    expect([...cut]).toHaveLength(10);
  });
});
