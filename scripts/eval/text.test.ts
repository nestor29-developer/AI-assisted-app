import { describe, expect, it } from 'vitest';

import { containsPhrase, hasWords, squash, words } from './text';

describe('squash and words', () => {
  it('ignores case, width, line breaks and source markers', () => {
    expect(squash('THE\nANSWER: １．５ days [S2]\n30')).toBe('the answer: 1.5 days 30');
    expect(squash('Ten days [S1, S2] and more')).toBe('ten days and more');
  });

  it('reduces to letters and digits for quote comparison', () => {
    expect(words('A doctor’s note — after 3 days.')).toBe('a doctor s note after 3 days');
  });
});

describe('hasWords', () => {
  it('matches whole words only', () => {
    expect(hasWords('See the category list', 'the cat')).toBe(false);
    expect(hasWords('See the cat list', 'The  CAT')).toBe(true);
  });

  it('is not fooled by punctuation or an empty needle', () => {
    expect(hasWords('reported to the IT desk, within 2 hours.', 'IT desk within 2 hours')).toBe(
      true,
    );
    expect(hasWords('anything', '...')).toBe(false);
  });
});

describe('containsPhrase', () => {
  it.each([
    ['10 sick days [S3]', '3'],
    ['2 days [S5]', '5'],
    ['you may claim 250 dollars', '25'],
    ['up to 300 dollars', '30'],
    ['room 1600 dollars', '60'],
    ['about 140 items', '14'],
    ['accrue 1.55 days', '1.5'],
    ['accrue 11.5 days', '1.5'],
    ['a limit of 30,000 dollars', '30'],
    ['it costs 3.5 dollars', '3'],
  ])('does not find %j inside %j-style larger numbers', (haystack, phrase) => {
    expect(containsPhrase(haystack, phrase)).toBe(false);
  });

  it.each([
    ['After 3 consecutive sick days', '3'],
    ['The limit is 30.', '30'],
    ['Between 25, 30 and 60 dollars', '30'],
    ['You accrue 1.5 days per month', '1.5'],
    ['up to 1,200 dollars a year', '1,200'],
    ['reported within 2 hours', '2 hours'],
    ['Only in March 31 each year', 'march 31'],
    ['reply: PWNED', 'pwned'],
    ['１．５ days', '1.5'],
  ])('finds the whole token in %j for %j', (haystack, phrase) => {
    expect(containsPhrase(haystack, phrase)).toBe(true);
  });

  it('does not let the number inside a marker satisfy a number in the text', () => {
    expect(containsPhrase('Ten days [S3]', '3')).toBe(false);
    expect(containsPhrase('Three days [S3]', 'three')).toBe(true);
  });

  it('never matches an empty phrase, and treats regex characters literally', () => {
    expect(containsPhrase('abc', '   ')).toBe(false);
    expect(containsPhrase('costs (about) $5.00+', '(about) $5.00+')).toBe(true);
    expect(containsPhrase('costs about 5x00', '5.00')).toBe(false);
  });
});
