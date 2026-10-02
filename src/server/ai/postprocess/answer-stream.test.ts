import { describe, expect, it } from 'vitest';

import { AnswerStreamExtractor } from './answer-stream';

const ANSWERS = [
  'Employees accrue 1.5 vacation days per month [S1].',
  'She said "never" and used a back\\slash, then a tab\there.\nNew line too.',
  'Emoji \u{1F389} and a family \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467} stay intact.',
  '第一条：员工每月累计年假。',
  'Looks like JSON: {"answer": "nested", "status": "x"} and ] [ , : tokens',
  'Control \u0001 and separators \u{2028}\u{2029} are escaped by JSON.stringify.',
  '',
  'x'.repeat(3_000),
];

function variants(answer: string): { label: string; json: string }[] {
  const body = {
    status: 'answered',
    answer,
    citations: [{ sourceId: 'S1', quote: 'a "quoted" bit with \\ and \u{1F600}' }],
    followUpQuestions: ['One?', 'Two?'],
  };
  const reordered = {
    citations: body.citations,
    followUpQuestions: body.followUpQuestions,
    status: body.status,
    answer,
  };
  const decoy = {
    meta: { answer: 'NOT THE ANSWER' },
    status: 'answer',
    list: [{ answer: 'ALSO NOT' }],
    answer,
  };
  const literalsFirst = {
    count: 42,
    ratio: -1.5e3,
    ok: true,
    off: false,
    none: null,
    nested: { deep: { answer: 'NOT THE ANSWER', list: [1, [2, { answer: 'NOR THIS' }]] } },
    answer,
  };
  return [
    { label: 'compact', json: JSON.stringify(body) },
    { label: 'pretty', json: JSON.stringify(body, null, 2) },
    { label: 'reordered keys', json: JSON.stringify(reordered) },
    { label: 'decoy keys', json: JSON.stringify(decoy) },
    { label: 'literals and deep nesting first', json: JSON.stringify(literalsFirst) },
  ];
}

function feed(
  json: string,
  cuts: number[],
): { deltas: string[]; extractor: AnswerStreamExtractor } {
  const extractor = new AnswerStreamExtractor();
  const deltas: string[] = [];
  let previous = 0;
  for (const cut of [...cuts, json.length]) {
    deltas.push(extractor.push(json.slice(previous, cut)));
    previous = cut;
  }
  return { deltas, extractor };
}

describe('AnswerStreamExtractor', () => {
  it('extracts the whole answer from a complete document', () => {
    const extractor = new AnswerStreamExtractor();
    expect(extractor.push(JSON.stringify({ status: 'answered', answer: 'Hello [S1].' }))).toBe(
      'Hello [S1].',
    );
    expect(extractor.done).toBe(true);
  });

  it.each(ANSWERS.flatMap((answer) => variants(answer).map((v) => ({ ...v, answer }))))(
    'is identical however the stream is chunked: $label, answer of $answer.length chars',
    ({ json, answer }) => {
      // Split at every single index (two chunks), plus one-character-at-a-time.
      const step = Math.max(1, Math.floor(json.length / 400));
      for (let cut = 0; cut <= json.length; cut += step) {
        const { deltas } = feed(json, [cut]);
        expect(deltas.join('')).toBe(answer);
      }
      expect(feed(json, [...Array(json.length).keys()]).deltas.join('')).toBe(answer);
    },
  );

  it('only ever emits well-formed text, even when a surrogate pair is split across chunks', () => {
    const json = JSON.stringify({ status: 'answered', answer: 'party \u{1F389}\u{1F38A} time' });

    const { deltas } = feed(json, [...Array(json.length).keys()]);

    for (const delta of deltas) expect(delta.isWellFormed()).toBe(true);
    expect(deltas.join('')).toBe('party \u{1F389}\u{1F38A} time');
  });

  it('decodes \\u escapes, including surrogate pairs written as two escapes', () => {
    const json = String.raw`{"status":"answered","answer":"café 🎉 中文"}`;

    expect(feed(json, [...Array(json.length).keys()]).deltas.join('')).toBe('café \u{1F389} 中文');
  });

  it('never leaks half-decoded escapes from an incomplete stream', () => {
    const json = JSON.stringify({ status: 'answered', answer: 'line\none \u{1F600} \\ "q" done' });
    const expected = 'line\none \u{1F600} \\ "q" done';

    for (let prefix = 0; prefix <= json.length; prefix += 1) {
      const text = new AnswerStreamExtractor();
      text.push(json.slice(0, prefix));
      expect(expected.startsWith(text.text)).toBe(true);
      expect(text.text).not.toMatch(/\\u|\\n|\\"/);
    }
  });

  it('reports done only after the closing quote of the answer', () => {
    const json = '{"status":"answered","answer":"abc"}';
    const extractor = new AnswerStreamExtractor();

    extractor.push(json.slice(0, json.indexOf('abc') + 2));
    expect(extractor.done).toBe(false);
    extractor.push(json.slice(json.indexOf('abc') + 2));
    expect(extractor.done).toBe(true);
  });

  it('emits only well-formed text even when the escapes spell a broken pair', () => {
    const broken = String.raw`{"answer":"x\ud83dy, \ude00 z, \ud83d😀"}`;

    const { deltas } = feed(broken, [...Array(broken.length).keys()]);

    for (const delta of deltas) expect(delta.isWellFormed()).toBe(true);
    expect(deltas.join('')).toBe('x\u{FFFD}y, \u{FFFD} z, \u{FFFD}\u{1F600}');
  });

  it('replaces malformed \\u escapes with U+FFFD instead of guessing a character', () => {
    const json = String.raw`{"answer":"a\u-123b\uZZZZc\u12G4d"}`;

    expect(new AnswerStreamExtractor().push(json)).toBe('a\u{FFFD}b\u{FFFD}c\u{FFFD}d');
  });

  it('replaces a dangling high surrogate with U+FFFD when the string ends', () => {
    const json = String.raw`{"answer":"broken \ud83c"}`;
    expect(new AnswerStreamExtractor().push(json)).toBe('broken \u{FFFD}');
  });

  it('ignores a second "answer" key and tolerates garbage without throwing', () => {
    const doubled = '{"answer":"first","answer":"second"}';
    expect(new AnswerStreamExtractor().push(doubled)).toBe('first');

    for (const junk of [
      '',
      '}{',
      '"answer"',
      '{"answer":',
      'not json at all',
      '{"answer": 42, "x": "y"}',
    ]) {
      expect(() => new AnswerStreamExtractor().push(junk)).not.toThrow();
    }
  });

  it('emits nothing when the response has no answer field', () => {
    expect(new AnswerStreamExtractor().push('{"status":"not_found","citations":[]}')).toBe('');
  });
});
