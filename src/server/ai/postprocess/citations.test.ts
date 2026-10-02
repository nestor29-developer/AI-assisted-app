import { describe, expect, it } from 'vitest';

import { matchTokens, resolveCitations, verifyQuote } from './citations';
import type { SourceRef } from './types';

const SOURCE =
  'Employees accrue 1.5 vacation days per month. Unused days expire on March 31 of the following year, ' +
  'and managers must approve any carry-over request in writing before the end of February.';

const words = (count: number, prefix = 'word') =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}x`);

describe('verifyQuote: the same words, however they are written', () => {
  it.each([
    ['an exact quote', 'Employees accrue 1.5 vacation days per month.'],
    ['different case and punctuation', 'EMPLOYEES ACCRUE 1.5 VACATION DAYS PER MONTH'],
    [
      'smart quotes and odd spacing',
      '  Unused   days\nexpire on March 31 — of the following year ',
    ],
    ['a quote from the middle', 'managers must approve any carry-over request in writing'],
    ['full-width letters and digits', 'ＥＭＰＬＯＹＥＥＳ accrue １．５ vacation days per month'],
    ['a short quote made of numbers and real words', 'accrue 1.5 vacation'],
  ])('accepts %s', (_label, quote) => {
    expect(verifyQuote(quote, SOURCE)).toBe(true);
  });

  it.each([
    [
      'a missing apostrophe',
      'The employee can’t carry over unused days.',
      'the employee cant carry over unused days',
    ],
    [
      'case folding of ß',
      'Die Straße ist gesperrt für Fahrzeuge.',
      'DIE STRASSE IST GESPERRT FÜR FAHRZEUGE',
    ],
    ['case folding of a dotless i', 'Kız çocukları okula gidiyor.', 'KIZ ÇOCUKLARI OKULA gidiyor'],
    [
      'a digit separator',
      'The budget is 1,000,000 dollars per year.',
      'The budget is 1000000 dollars per year',
    ],
    [
      'a decomposed accent',
      'The café opens at nine every morning.',
      'the cafe\u{301} opens at nine every morning',
    ],
    [
      'a word the PDF hyphenated at a line end',
      'Submit each ex-\npense report within thirty days.',
      'each expense report within thirty days',
    ],
    [
      'a real hyphen at a line end',
      'Managers approve carry-\nover requests in writing.',
      'managers approve carry-over requests in writing',
    ],
  ])('accepts %s', (_label, source, quote) => {
    expect(verifyQuote(quote, source)).toBe(true);
  });

  it('works for unspaced scripts by counting each CJK character', () => {
    const source = '员工每月累计一点五天年假。未使用的年假三月过期。';

    expect(verifyQuote('员工每月累计一点五天年假', source)).toBe(true);
    expect(verifyQuote('员工可以无限期休假', source)).toBe(false);
  });
});

describe('verifyQuote: anything that is not in the source word for word', () => {
  it.each([
    ['an invented sentence', 'Employees receive unlimited paid leave every single year.'],
    ['real words in the wrong order', 'month per days vacation 1.5 accrue Employees'],
    ['text from another topic', 'The server rack needs additional cooling capacity.'],
    ['a paraphrase with every word replaced', 'Staff earn holiday time monthly at a fixed rate.'],
    [
      'one changed word in a long quote',
      'managers must approve any carry-over request in writing before the end of March',
    ],
    ['one changed number', 'Employees accrue 2.5 vacation days per month.'],
    ['an inserted word', 'Employees accrue 1.5 paid vacation days per month.'],
    ['fragments stitched together out of order', 'carry-over request in writing. Employees accrue'],
    ['fragments joined with an ellipsis', 'Employees accrue ... before the end of February'],
  ])('rejects %s', (_label, quote) => {
    expect(verifyQuote(quote, SOURCE)).toBe(false);
  });

  it('rejects a dropped negation, which flips the meaning', () => {
    const source = 'Employees must not share their passwords with anyone under any circumstances.';

    expect(verifyQuote('Employees must not share their passwords with anyone', source)).toBe(true);
    expect(verifyQuote('Employees must share their passwords with anyone', source)).toBe(false);
  });

  it('checks every word of a long quote, not just the first ones', () => {
    const source = words(120).join(' ');

    expect(verifyQuote(words(90).join(' '), source)).toBe(true);
    expect(verifyQuote(`${words(90).join(' ')} plus an invented tail`, source)).toBe(false);
  });

  it('checks every character of a long CJK quote too', () => {
    const source = Array.from({ length: 120 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
    const invented = Array.from({ length: 16 }, (_, i) => String.fromCodePoint(0x5e00 + i)).join(
      '',
    );

    expect(verifyQuote(source.slice(0, 100), source)).toBe(true);
    expect(verifyQuote(source.slice(0, 100) + invented, source)).toBe(false);
  });

  it('refuses quotes too short or too empty to prove anything', () => {
    const source =
      'The meeting is open to the public. Join us at the heart of the company on Friday.';

    expect(verifyQuote('', source)).toBe(false);
    expect(verifyQuote('   ...   ', source)).toBe(false);
    expect(verifyQuote('open to', source)).toBe(false);
    expect(verifyQuote('of the company', source)).toBe(false);
    expect(verifyQuote('is open to the', source)).toBe(false);
    expect(verifyQuote('up to 30 days', 'Carry-over is allowed up to 30 days.')).toBe(true);
  });
});

describe('matchTokens', () => {
  it('lowercases, folds width and apostrophes, drops punctuation and splits CJK per character', () => {
    expect(matchTokens('Hello, WORLD！ It’s 3.5%')).toEqual(['hello', 'world', 'its', '3', '5']);
    expect(matchTokens('员工abc')).toEqual(['员', '工', 'abc']);
  });

  it('keeps combining marks of scripts that cannot be precomposed', () => {
    expect(matchTokens('कर्मचारी')).toEqual(['कर्मचारी']);
  });

  it('joins digit groups so 1,000 and 1000 match, but leaves decimals alone', () => {
    expect(matchTokens('1,000,000 and 3.5 and 12,34')).toEqual([
      '1000000',
      'and',
      '3',
      '5',
      'and',
      '12',
      '34',
    ]);
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

  it('keeps at most eight citations, however many the model sends', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      sourceId: 'S1',
      quote: `Invented claim number ${i} that appears nowhere`,
    }));

    expect(resolveCitations(many, sources).citations).toHaveLength(8);
  });

  it('strips hidden characters from quotes', () => {
    const hidden = String.fromCodePoint(0xe0041, 0xe0042);
    const { citations } = resolveCitations(
      [{ sourceId: 'S1', quote: `Employees accrue${hidden} 1.5 vacation days per month.` }],
      sources,
    );

    expect(citations[0]!.quote).toBe('Employees accrue 1.5 vacation days per month.');
    expect(citations[0]!.verified).toBe(true);
  });

  it('shortens a very long quote at a word boundary, so what is shown still verifies', () => {
    const text = words(200).join(' ');
    const { citations } = resolveCitations(
      [{ sourceId: 'S1', quote: text.slice(0, 700) }],
      [{ id: 'S1', chunkId: 'c', page: null, text }],
    );

    const quote = citations[0]!.quote;
    expect(quote.length).toBeLessThanOrEqual(400);
    expect(quote.length).toBeGreaterThan(300);
    expect(text.startsWith(quote)).toBe(true);
    expect(text.charAt(quote.length)).toBe(' ');
    expect(citations[0]!.verified).toBe(true);
  });

  it('never cuts a quote in the middle of a surrogate pair', () => {
    const text = `${'word '.repeat(79)}\u{1F600}\u{1F600}\u{1F600} and then some more words after that`;
    const { citations } = resolveCitations(
      [{ sourceId: 'S1', quote: text }],
      [{ id: 'S1', chunkId: 'c', page: null, text }],
    );

    expect(citations[0]!.quote.isWellFormed()).toBe(true);
  });
});
