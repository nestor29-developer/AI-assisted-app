import { describe, expect, it } from 'vitest';

import { significantTokens, splitSentences } from './mock-text';

describe('splitSentences', () => {
  it('splits on sentence marks followed by space, and keeps a decimal number whole', () => {
    expect(
      splitSentences('Accrual is 1.5 days per month. Unused days expire! Why? Because.'),
    ).toEqual(['Accrual is 1.5 days per month.', 'Unused days expire!', 'Why?', 'Because.']);
  });

  it('joins a sentence a PDF wrapped across lines, instead of cutting it at each line', () => {
    const wrapped =
      'Receipts are required for any single expense above 25 dollars and must be\nsubmitted within 30 days.';

    expect(splitSentences(wrapped)).toEqual([
      'Receipts are required for any single expense above 25 dollars and must be submitted within 30 days.',
    ]);
  });

  it('never starts a sentence in lower case in the middle of a wrapped one', () => {
    const wrapped =
      'Meals during business travel are\nreimbursed up to 60 dollars per day.\nReceipts are\nrequired.';

    for (const sentence of splitSentences(wrapped)) expect(sentence).toMatch(/^[A-Z]/);
  });

  it('treats a blank line as the end of a block, even a heading with no full stop', () => {
    expect(
      splitSentences('Leave\n\nFull-time employees accrue days.\n\nRemote work\n\nNeeds approval.'),
    ).toEqual(['Leave', 'Full-time employees accrue days.', 'Remote work', 'Needs approval.']);
  });

  it('copes with Windows line endings and blank lines that hold spaces', () => {
    expect(splitSentences('One sentence\r\ncontinues here.\r\n\r\nTwo.\n  \nThree.')).toEqual([
      'One sentence continues here.',
      'Two.',
      'Three.',
    ]);
  });

  it('splits CJK sentences, which have no space after the full stop', () => {
    expect(splitSentences('今日は晴れです。明日は雨です。')).toEqual([
      '今日は晴れです。',
      '明日は雨です。',
    ]);
  });

  it('returns nothing for blank text', () => {
    expect(splitSentences(' \n\n  \n')).toEqual([]);
  });
});

describe('significantTokens', () => {
  it('drops stop words and strips a plural s', () => {
    expect(significantTokens('What are the key dates or deadlines?')).toEqual([
      'key',
      'date',
      'deadline',
    ]);
  });
});
