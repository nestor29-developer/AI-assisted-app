import { describe, expect, it } from 'vitest';

import { UnprocessableError, UnsupportedMediaTypeError } from '@/server/core/errors';
import { buildPdf } from '@/test/helpers/pdf';

import { detectFileKind, extractorFor, mimeTypeFor } from './index';
import { PdfExtractor } from './pdf';
import { PlainTextExtractor } from './plain-text';

const limits = { maxPdfPages: 10, parseTimeoutMs: 10_000 };
const utf8 = (text: string) => new TextEncoder().encode(text);

const PAGE_ONE = 'Employees accrue 1.5 vacation days per month and may carry over five days.';
const PAGE_TWO = 'Remote work requires written approval from the direct manager each quarter.';

describe('detectFileKind', () => {
  it.each([
    ['notes.txt', utf8('hello'), 'text'],
    ['README.MD', utf8('# hi'), 'markdown'],
    ['report.pdf', buildPdf(['x']), 'pdf'],
    ['Report.PDF', buildPdf(['x']), 'pdf'],
  ] as const)('recognises %s as %s', (name, bytes, kind) => {
    expect(detectFileKind({ name, bytes })).toBe(kind);
  });

  it.each(['notes.docx', 'script.exe', 'archive.zip', 'no-extension', 'photo.png'])(
    'refuses unsupported type %s with a 415',
    (name) => {
      expect(() => detectFileKind({ name, bytes: utf8('x') })).toThrow(UnsupportedMediaTypeError);
    },
  );

  it('does not trust the extension alone: a renamed file is rejected either way round', () => {
    expect(() => detectFileKind({ name: 'fake.pdf', bytes: utf8('just text') })).toThrow(
      UnprocessableError,
    );
    expect(() => detectFileKind({ name: 'sneaky.txt', bytes: buildPdf(['x']) })).toThrow(
      UnprocessableError,
    );
  });

  it('tolerates the few junk bytes some producers put before the PDF header', () => {
    const bytes = new Uint8Array([...utf8('\n\n  '), ...buildPdf(['x'])]);
    expect(detectFileKind({ name: 'odd.pdf', bytes })).toBe('pdf');
  });

  it('maps kinds to canonical MIME types instead of echoing what the client claimed', () => {
    expect(mimeTypeFor('pdf')).toBe('application/pdf');
    expect(mimeTypeFor('markdown')).toBe('text/markdown');
    expect(mimeTypeFor('text')).toBe('text/plain');
  });
});

describe('PlainTextExtractor', () => {
  const extractor = new PlainTextExtractor();

  it('decodes UTF-8, including non-ASCII text, and drops a byte-order mark', async () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('café 中文')]);

    expect(await extractor.extract(withBom)).toEqual({
      pages: null,
      text: 'café 中文',
      pageCount: null,
    });
  });

  it('rejects bytes that are not valid UTF-8 rather than guessing an encoding', async () => {
    await expect(extractor.extract(new Uint8Array([0x66, 0xff, 0xfe, 0x6f]))).rejects.toThrow(
      UnprocessableError,
    );
  });

  it('rejects binary data that happens to decode', async () => {
    await expect(extractor.extract(utf8('text\u0000with a NUL'))).rejects.toMatchObject({
      detail: expect.stringContaining('binary'),
    });
  });
});

describe('PdfExtractor (real PDFs)', () => {
  const extractor = new PdfExtractor();

  it('returns the text of each page separately, so citations can name a page', async () => {
    const result = await extractor.extract(buildPdf([PAGE_ONE, PAGE_TWO]), limits);

    expect(result.pageCount).toBe(2);
    expect(result.pages).toHaveLength(2);
    expect(result.pages![0]).toContain('vacation days per month');
    expect(result.pages![1]).toContain('written approval');
    expect(result.text.split('\f')).toHaveLength(2);
  });

  it('handles text that wraps over several lines', async () => {
    const long = Array.from({ length: 40 }, (_, i) => `sentence${i}`).join(' ');

    const { pages } = await extractor.extract(buildPdf([long]), limits);

    expect(pages![0]).toContain('sentence0');
    expect(pages![0]).toContain('sentence39');
  });

  it('refuses a PDF with no text layer (scanned) and says so clearly', async () => {
    const scanned = buildPdf(['', '', '']);

    const error = await extractor.extract(scanned, limits).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnprocessableError);
    expect(error).toMatchObject({ code: 'PDF_NO_TEXT_LAYER', status: 422 });
  });

  it('refuses a mostly image-only PDF where a stray footer is all the text there is', async () => {
    const mostlyScanned = buildPdf(['', '', '', '', '', '', 'p. 7']);

    await expect(extractor.extract(mostlyScanned, limits)).rejects.toMatchObject({
      code: 'PDF_NO_TEXT_LAYER',
    });
  });

  it('enforces the page limit before extracting any text', async () => {
    const manyPages = buildPdf(Array.from({ length: 11 }, () => PAGE_ONE));

    await expect(extractor.extract(manyPages, limits)).rejects.toMatchObject({
      code: 'DOCUMENT_REJECTED',
      detail: expect.stringContaining('limit is 10'),
    });
  });

  it('turns a corrupt or truncated PDF into a clear 422, never a 500', async () => {
    const valid = buildPdf([PAGE_ONE]);
    const corrupt = [valid.slice(0, 40), new Uint8Array([...utf8('%PDF-1.4\n'), 1, 2, 3, 4, 5])];

    for (const bytes of corrupt) {
      await expect(extractor.extract(bytes, limits)).rejects.toBeInstanceOf(UnprocessableError);
    }
  });

  it('does not modify the caller’s bytes (pdf.js would otherwise detach the buffer)', async () => {
    const bytes = buildPdf([PAGE_ONE]);
    const before = bytes.length;

    await extractor.extract(bytes, limits);

    expect(bytes.length).toBe(before);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it('gives up on a PDF that takes too long to parse', async () => {
    const slow = new PdfExtractor(() => new Promise(() => {}));

    await expect(
      slow.extract(buildPdf([PAGE_ONE]), { ...limits, parseTimeoutMs: 20 }),
    ).rejects.toMatchObject({
      code: 'DOCUMENT_REJECTED',
      detail: expect.stringContaining('too long'),
    });
  });

  it('is selected by extractorFor for pdf files', () => {
    expect(extractorFor('pdf')).toBeInstanceOf(PdfExtractor);
    expect(extractorFor('markdown')).toBeInstanceOf(PlainTextExtractor);
  });
});
