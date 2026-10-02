import { describe, expect, it } from 'vitest';

import { chunkPages, chunkText, type ChunkOptions } from './chunker';

const options: ChunkOptions = { maxChars: 200, overlapChars: 40 };

const sentence = (n: number) => `Sentence number ${n} talks about topic ${n % 7} in some detail.`;
const paragraph = (n: number, sentences = 5) =>
  Array.from({ length: sentences }, (_, i) => sentence(n * 10 + i)).join(' ');

/** Small seeded PRNG so the fuzz test is reproducible. */
function prng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

describe('chunkText', () => {
  it('returns one chunk for short text and nothing for blank text', () => {
    expect(chunkText('  Short note.  ', options)).toEqual([{ text: 'Short note.', page: null }]);
    expect(chunkText('   \n\n  ', options)).toEqual([]);
  });

  it('never exceeds maxChars and never emits empty chunks', () => {
    const text = Array.from({ length: 12 }, (_, i) => paragraph(i)).join('\n\n');

    const chunks = chunkText(text, options);

    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(options.maxChars);
      expect(chunk.text.trim()).toBe(chunk.text);
      expect(chunk.text.length).toBeGreaterThan(0);
    }
  });

  it('prefers paragraph boundaries over cutting inside a paragraph', () => {
    const first = 'A'.repeat(50) + ' first paragraph.';
    const second = 'B'.repeat(50) + ' second paragraph.';

    const chunks = chunkText(`${first}\n\n${second}`, {
      maxChars: first.length + 5,
      overlapChars: 0,
    });

    expect(chunks.map((c) => c.text)).toEqual([first, second]);
  });

  it('overlaps consecutive chunks with whole words from the previous one', () => {
    const text = Array.from({ length: 6 }, (_, i) => paragraph(i, 4)).join(' ');

    const chunks = chunkText(text, options);

    for (let i = 1; i < chunks.length; i += 1) {
      const previous = chunks[i - 1]!.text;
      const current = chunks[i]!.text;
      const firstWord = current.split(/\s+/)[0]!;
      const overlapStart = previous.lastIndexOf(firstWord);
      expect(overlapStart).toBeGreaterThanOrEqual(0);
      expect(previous.length - overlapStart).toBeLessThanOrEqual(
        options.overlapChars + firstWord.length,
      );
    }
  });

  it('hard-splits text with no separators at all, still overlapping by the configured amount', () => {
    const chunks = chunkText('x'.repeat(1000), { maxChars: 300, overlapChars: 30 });

    expect(chunks.map((c) => c.text.length)).toEqual([270, 300, 300, 220]);
  });

  it('never inserts characters that were not in the source (no spaces added to unspaced text)', () => {
    const source = '\u5B57'.repeat(900);

    const chunks = chunkText(source, { maxChars: 200, overlapChars: 20 });

    for (const chunk of chunks) expect(chunk.text).toMatch(/^\u5B57+$/);
  });

  it('does not split emoji or other surrogate pairs', () => {
    const chunks = chunkText('\u{1F600}'.repeat(500), { maxChars: 101, overlapChars: 10 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.isWellFormed()).toBe(true);
      expect(chunk.text.length).toBeLessThanOrEqual(101);
    }
  });

  it('keeps repeated content: identical paragraphs are not "deduplicated" away', () => {
    const boilerplate = 'This page is intentionally identical to the one before it, word for word.';
    const text = Array.from({ length: 6 }, () => boilerplate).join('\n\n');

    const chunks = chunkText(text, { maxChars: boilerplate.length + 2, overlapChars: 0 });

    expect(chunks).toHaveLength(6);
  });

  it('splits unspaced CJK text at sentence marks instead of mid-sentence', () => {
    const sentences = Array.from(
      { length: 30 },
      (_, i) => `\u7B2C${i}\u53E5\u5B50\u8BB2\u8FF0\u4E86\u4E3B\u9898\u3002`,
    );

    const chunks = chunkText(sentences.join(''), { maxChars: 60, overlapChars: 0 });

    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(60);
      expect(chunk.text.endsWith('\u3002')).toBe(true);
    }
  });

  it('is deterministic', () => {
    const text = Array.from({ length: 8 }, (_, i) => paragraph(i)).join('\n\n');
    expect(chunkText(text, options)).toEqual(chunkText(text, options));
  });

  it('terminates on tiny chunk sizes with astral characters instead of looping forever', () => {
    const chunks = chunkText('\u{1F600}'.repeat(20), { maxChars: 3, overlapChars: 1 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.text.isWellFormed()).toBe(true);
  });

  it('rejects options that leave no room for even one surrogate pair', () => {
    expect(() => chunkText('text', { maxChars: 3, overlapChars: 2 })).toThrow(RangeError);
  });

  it('rejects an overlap that is not smaller than the chunk size', () => {
    expect(() => chunkText('text', { maxChars: 100, overlapChars: 100 })).toThrow(RangeError);
  });

  it('keeps every word of the input in some chunk, whatever the input looks like (fuzz)', () => {
    const random = prng(42);
    const alphabet = [
      'alpha',
      'beta',
      'gamma',
      'delta',
      'epsilon',
      '\n',
      '\n\n',
      '. ',
      ', ',
      'x'.repeat(250),
    ];

    for (let run = 0; run < 150; run += 1) {
      const pieces = Array.from(
        { length: 5 + Math.floor(random() * 120) },
        () => alphabet[Math.floor(random() * alphabet.length)]!,
      );
      const text = pieces.join(random() > 0.5 ? ' ' : '');

      const chunks = chunkText(text, options);
      const joined = chunks.map((c) => c.text).join('\n');

      for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(options.maxChars);
      for (const word of text
        .split(/\s+/)
        .filter((w) => w.length > 0 && w.length <= options.maxChars)) {
        expect(joined).toContain(word.length > 40 ? word.slice(0, 40) : word);
      }
    }
  });
});

describe('chunkPages', () => {
  it('numbers chunks by page, skips blank pages and never spans pages', () => {
    const pages = [paragraph(1, 8), '   ', 'Short last page.'];

    const chunks = chunkPages(pages, options);

    expect(chunks.some((c) => c.page === 2)).toBe(false);
    expect(chunks.filter((c) => c.page === 1).length).toBeGreaterThan(1);
    expect(chunks.at(-1)).toEqual({ text: 'Short last page.', page: 3 });
    for (const chunk of chunks.filter((c) => c.page === 1)) {
      expect(chunk.text).not.toContain('Short last page');
    }
  });
});
