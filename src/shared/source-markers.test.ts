import { describe, expect, it } from 'vitest';

import { extractSourceMarkers, splitAtSourceMarkers, stripSourceMarkers } from './source-markers';

describe('extractSourceMarkers', () => {
  it('returns each marker once, in order of first appearance', () => {
    expect(
      extractSourceMarkers('Yes [S1], see also [S2] and again [S1]. Not markers: [x] [S] S3 [S1x]'),
    ).toEqual(['S1', 'S2']);
  });

  it.each([
    ['a comma list', 'Both agree [S1, S2].', ['S1', 'S2']],
    ['a semicolon list', 'Both agree [S1; S3].', ['S1', 'S3']],
    ['a list without spaces', 'Both agree [S1,S2,S4].', ['S1', 'S2', 'S4']],
    ['lower case and inner spaces', 'Agrees [s 2].', ['S2']],
    ['padding inside the brackets', 'Agrees [ S3 ].', ['S3']],
    ['adjacent groups', 'Agrees [S1][S2].', ['S1', 'S2']],
    ['leading zeros', 'Agrees [S01].', ['S1']],
  ])('reads %s', (_label, text, expected) => {
    expect(extractSourceMarkers(text)).toEqual(expected);
  });

  it('ignores brackets that hold anything else', () => {
    expect(extractSourceMarkers('See [Section 5], [S1 and more], [S], [1], [S1.2].')).toEqual([]);
  });

  it('stays fast on bracket and whitespace floods', () => {
    const started = performance.now();

    extractSourceMarkers(`${'[ '.repeat(100_000)}${' '.repeat(100_000)}[S1`);
    extractSourceMarkers(`[S1${' ,'.repeat(100_000)}`);

    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe('stripSourceMarkers', () => {
  it('removes markers and the space in front of them', () => {
    expect(stripSourceMarkers('Employees accrue days [S1]. Also [S2, S3] holidays [s4].')).toBe(
      'Employees accrue days. Also holidays.',
    );
  });

  it('keeps line breaks and unrelated brackets', () => {
    expect(stripSourceMarkers('First [S1]\nSecond [note] [S2]')).toBe('First\nSecond [note]');
  });

  it('stays fast on a long run of whitespace', () => {
    const started = performance.now();

    stripSourceMarkers(`${' '.repeat(200_000)}x`);

    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('splitAtSourceMarkers', () => {
  it('splits an answer into text and marker groups, in order', () => {
    expect(
      splitAtSourceMarkers('Days accrue monthly [S1]. Remote work needs approval [S2, S3].'),
    ).toEqual([
      { kind: 'text', text: 'Days accrue monthly ' },
      { kind: 'markers', ids: ['S1'] },
      { kind: 'text', text: '. Remote work needs approval ' },
      { kind: 'markers', ids: ['S2', 'S3'] },
      { kind: 'text', text: '.' },
    ]);
  });

  it('returns the whole text when there are no markers, and nothing for empty text', () => {
    expect(splitAtSourceMarkers('No markers here [x].')).toEqual([
      { kind: 'text', text: 'No markers here [x].' },
    ]);
    expect(splitAtSourceMarkers('')).toEqual([]);
  });

  it('handles markers at the very start, the very end and back to back', () => {
    expect(splitAtSourceMarkers('[S1][s 2] done [S3]')).toEqual([
      { kind: 'markers', ids: ['S1'] },
      { kind: 'markers', ids: ['S2'] },
      { kind: 'text', text: ' done ' },
      { kind: 'markers', ids: ['S3'] },
    ]);
  });

  it('gives back exactly the text it was given when the markers are put back', () => {
    const text = 'A [S1] b [S2, S3] c [s4]';

    const rebuilt = splitAtSourceMarkers(text)
      .map((segment) => (segment.kind === 'text' ? segment.text : `[${segment.ids.join(', ')}]`))
      .join('');

    expect(rebuilt.replace(/\[s4\]/i, '[S4]')).toBe(text.replace('[s4]', '[S4]'));
  });
});
