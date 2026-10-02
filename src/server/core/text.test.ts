import { describe, expect, it } from 'vitest';

import { splitAtWidth, truncate } from './text';

describe('truncate', () => {
  it('returns short text untouched and cuts long text at the limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('hello', 5)).toBe('hello');
    expect(truncate('hello world', 5)).toBe('hello');
  });

  it('never leaves half of a surrogate pair behind', () => {
    const text = `${'a'.repeat(9)}\u{1F600}tail`;

    const cut = truncate(text, 10);

    expect(cut).toBe('a'.repeat(9));
    expect(cut.isWellFormed()).toBe(true);
    expect(truncate(text, 11)).toBe(`${'a'.repeat(9)}\u{1F600}`);
  });

  it('handles degenerate limits', () => {
    expect(truncate('abc', 0)).toBe('');
    expect(truncate('abc', -4)).toBe('');
    expect(truncate('\u{1F600}', 1)).toBe('');
  });
});

describe('splitAtWidth', () => {
  it('cuts at the width and keeps every character', () => {
    expect(splitAtWidth('abcdefgh', 3)).toEqual(['abc', 'def', 'gh']);
    expect(splitAtWidth('', 3)).toEqual([]);
  });

  it('keeps surrogate pairs whole, including at width 1 where it must take the whole pair', () => {
    const emoji = '\u{1F600}'.repeat(6);

    for (const width of [1, 2, 3, 5]) {
      const pieces = splitAtWidth(emoji, width);
      expect(pieces.join('')).toBe(emoji);
      for (const piece of pieces) expect(piece.isWellFormed()).toBe(true);
    }
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects the width %s instead of looping forever', (width) => {
    expect(() => splitAtWidth('text', width)).toThrow(RangeError);
  });
});
