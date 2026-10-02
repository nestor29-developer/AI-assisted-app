import { describe, expect, it } from 'vitest';

import { extractMarkers, matchTokens, resolveCitations, verifyQuote } from './citations';
import type { SourceRef } from './types';

const SOURCE =
  'Employees accrue 1.5 vacation days per month. Unused days expire on March 31 of the following year, ' +
  'and managers must approve any carry-over request in writing before the end of February.';

describe('verifyQuote', () => {
  it.each([
    ['an exact quote', 'Employees accrue 1.5 vacation days per month.'],
    ['different case and punctuation', 'EMPLOYEES ACCRUE 1.5 VACATION DAYS PER MONTH'],
    [
      'smart quotes and odd spacing',
      '  Unused   days\nexpire on March 31 — of the following year ',
    ],
    ['a quote from the middle', 'managers must approve any carry-over request in writing'],
  ])('accepts %s', (_label, quote) => {
    expect(verifyQuote(quote, SOURCE)).toBe(true);
  });

  it('tolerates a single changed word in a longer quote', () => {
    const quote = 'managers must approve any carry-over request in writing before the end of March';

    expect(verifyQuote(quote, SOURCE)).toBe(true);
  });

  it.each([
    ['an invented sentence', 'Employees receive unlimited paid leave every single year.'],
    ['real words in the wrong order', 'month per days vacation 1.5 accrue Employees'],
    ['text from another topic', 'The server rack needs additional cooling capacity.'],
    ['a paraphrase with every word replaced', 'Staff earn holiday time monthly at a fixed rate.'],
  ])('rejects %s', (_label, quote) => {
    expect(verifyQuote(quote, SOURCE)).toBe(false);
  });

  it('refuses quotes too short to prove anything, and empty ones', () => {
    expect(verifyQuote('vacation days', SOURCE)).toBe(false);
    expect(verifyQuote('', SOURCE)).toBe(false);
    expect(verifyQuote('   ...   ', SOURCE)).toBe(false);
  });

  it('works for unspaced scripts by counting each CJK character', () => {
    const source = '员工每月累计一点五天年假。未使用的年假三月过期。';

    expect(verifyQuote('员工每月累计一点五天年假', source)).toBe(true);
    expect(verifyQuote('员工可以无限期休假', source)).toBe(false);
  });
});

describe('matchTokens', () => {
  it('lowercases, folds width, drops punctuation and splits CJK per character', () => {
    expect(matchTokens('Hello, WORLD！ It’s 3.5%')).toEqual([
      'hello',
      'world',
      'it',
      's',
      '3',
      '5',
    ]);
    expect(matchTokens('员工abc')).toEqual(['员', '工', 'abc']);
  });
});

describe('extractMarkers', () => {
  it('returns each [S#] marker once', () => {
    expect(
      extractMarkers('Yes [S1], see also [S2] and again [S1]. Not a marker: [x] [S] S3'),
    ).toEqual(['S1', 'S2']);
  });
});

describe('resolveCitations', () => {
  const sources: SourceRef[] = [
    { id: 'S1', chunkId: 'chunk-a', page: 4, text: SOURCE },
    {
      id: 'S2',
      chunkId: 'chunk-b',
      page: null,
      text: 'Remote work requires manager approval and a signed agreement.',
    },
  ];

  it('maps each citation to its chunk and page, and records whether the quote was verified', () => {
    const { citations, invalidReferences } = resolveCitations(
      [
        { sourceId: 'S1', quote: 'Employees accrue 1.5 vacation days per month.' },
        { sourceId: 'S2', quote: 'Remote work is open to everybody without any approval.' },
      ],
      sources,
    );

    expect(invalidReferences).toEqual([]);
    expect(citations).toEqual([
      {
        sourceId: 'S1',
        chunkId: 'chunk-a',
        page: 4,
        quote: 'Employees accrue 1.5 vacation days per month.',
        verified: true,
      },
      {
        sourceId: 'S2',
        chunkId: 'chunk-b',
        page: null,
        quote: 'Remote work is open to everybody without any approval.',
        verified: false,
      },
    ]);
  });

  it('reports ids that were never sent, instead of crashing or trusting them', () => {
    const { citations, invalidReferences } = resolveCitations(
      [
        { sourceId: 'S9', quote: 'Something the model made up entirely.' },
        { sourceId: 'S1', quote: 'Employees accrue 1.5 vacation days per month.' },
      ],
      sources,
    );

    expect(invalidReferences).toEqual(['S9']);
    expect(citations.map((c) => c.sourceId)).toEqual(['S1']);
  });

  it('collapses duplicate citations of the same quote', () => {
    const quote = 'Employees accrue 1.5 vacation days per month.';
    const { citations } = resolveCitations(
      [
        { sourceId: 'S1', quote },
        { sourceId: 'S1', quote: quote.toUpperCase() },
      ],
      sources,
    );

    expect(citations).toHaveLength(1);
  });

  it('strips hidden characters from quotes and caps their length', () => {
    const hidden = String.fromCodePoint(0xe0041, 0xe0042);
    const { citations } = resolveCitations(
      [
        {
          sourceId: 'S1',
          quote: `Employees accrue${hidden} 1.5 vacation days per month. ${'x'.repeat(1_000)}`,
        },
      ],
      sources,
    );

    expect(citations[0]!.quote).not.toContain(hidden);
    expect(citations[0]!.quote.length).toBeLessThanOrEqual(400);
  });
});
