import { describe, expect, it } from 'vitest';

import { parseAnswer } from './answer-parser';
import { DECLINED_MESSAGE, processAnswer, UNREADABLE_MESSAGE } from './process-answer';
import type { SourceRef } from './types';

const sources: SourceRef[] = [
  {
    id: 'S1',
    chunkId: 'chunk-1',
    page: 2,
    text: 'Employees accrue 1.5 vacation days per month. Unused days expire on March 31.',
  },
  {
    id: 'S2',
    chunkId: 'chunk-2',
    page: null,
    text: 'Remote work requires written manager approval.',
  },
];

const json = (value: object) => JSON.stringify(value);

const good = {
  answer: 'Employees accrue 1.5 vacation days per month [S1].',
  citations: [{ sourceId: 'S1', quote: 'Employees accrue 1.5 vacation days per month.' }],
  status: 'answered',
  followUpQuestions: ['When do unused days expire?'],
};

const remoteCitation = { sourceId: 'S2', quote: 'Remote work requires written manager approval.' };

const hidden = String.fromCodePoint(0xe0049, 0xe004e);

describe('parseAnswer', () => {
  it('accepts valid JSON and fills missing lists', () => {
    expect(parseAnswer(json(good)).ok).toBe(true);

    const minimal = parseAnswer(json({ status: 'not_found', answer: 'No.' }));
    expect(minimal).toMatchObject({ ok: true, payload: { citations: [], followUpQuestions: [] } });
  });

  it.each([
    ['a fence', '```json\n' + json(good) + '\n```'],
    ['a fence with a space and capital letters', '``` JSON\n' + json(good) + '\n```'],
    ['a fence with no language', '```\n' + json(good) + '\n```'],
    ['a sentence before a fence', 'Here you go:\n```json\n' + json(good) + '\n```'],
    ['a sentence after the object', json(good) + '\nHope this helps!'],
    ['a byte order mark', '\u{FEFF}' + json(good)],
    ['braces inside strings', json({ ...good, answer: 'Use {braces} and "quotes" [S1].' })],
  ])('accepts JSON wrapped in %s', (_label, raw) => {
    expect(parseAnswer(raw).ok).toBe(true);
  });

  it('keeps a good answer when the lists are null or hold junk', () => {
    const messy = parseAnswer(
      json({
        status: 'answered',
        answer: 'Fine.',
        citations: [
          { sourceId: 'S1', quote: 'a real one here' },
          { sourceId: 'S1' },
          { sourceId: 'S1', quote: null },
          'junk',
          null,
        ],
        followUpQuestions: ['One?', 42, null, { q: 'x' }],
      }),
    );

    expect(messy).toMatchObject({
      ok: true,
      payload: {
        citations: [{ sourceId: 'S1', quote: 'a real one here' }],
        followUpQuestions: ['One?'],
      },
    });
    expect(
      parseAnswer('{"status":"answered","answer":"x","citations":null,"followUpQuestions":null}'),
    ).toMatchObject({ ok: true, payload: { citations: [], followUpQuestions: [] } });
  });

  it.each([
    ['empty text', '', 'empty'],
    ['whitespace only', '  \n ', 'empty'],
    ['truncated JSON', '{"status":"answered","answer":"cut o', 'invalid_json'],
    ['plain prose', 'Sure! The answer is 42.', 'invalid_json'],
    [
      'a fence that was never closed',
      '```json\n{"status":"answered","answer":"cut',
      'invalid_json',
    ],
    ['an unknown status', json({ ...good, status: 'maybe' }), 'schema_mismatch'],
    ['a missing answer', json({ status: 'answered' }), 'schema_mismatch'],
    ['a non-object', '["answer"]', 'schema_mismatch'],
  ])('rejects %s', (_label, raw, reason) => {
    expect(parseAnswer(raw)).toEqual({ ok: false, reason });
  });

  it.each([
    ['a fence opener followed by newlines', '```json' + '\n'.repeat(100_000) + 'x'],
    ['a fence opener followed by spaces', '```json' + ' '.repeat(100_000)],
    ['newlines inside an unclosed fence', '```json\n' + '{\n'.repeat(1) + '\n'.repeat(100_000)],
    ['thousands of opening braces', '{'.repeat(100_000)],
    ['an unclosed string full of braces', `{"a":"${'{'.repeat(100_000)}`],
  ])('stays fast on %s', (_label, raw) => {
    const started = performance.now();

    parseAnswer(raw);

    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('processAnswer: well-formed replies', () => {
  it('scores a fully verified answer as high confidence', () => {
    const result = processAnswer({ raw: json(good), finishReason: 'stop', sources });

    expect(result).toMatchObject({
      status: 'answered',
      confidence: 'high',
      warnings: [],
      followUpQuestions: ['When do unused days expire?'],
    });
    expect(result.citations).toEqual([
      {
        sourceId: 'S1',
        chunkId: 'chunk-1',
        page: 2,
        quote: 'Employees accrue 1.5 vacation days per month.',
        verified: true,
      },
    ]);
  });

  it('flags a fabricated quote: unverified citation and lowered confidence', () => {
    const fabricated = {
      ...good,
      citations: [
        { sourceId: 'S1', quote: 'Employees get unlimited vacation whenever they like.' },
      ],
    };

    const result = processAnswer({ raw: json(fabricated), finishReason: 'stop', sources });

    expect(result.confidence).toBe('low');
    expect(result.warnings).toEqual(['UNVERIFIED_CITATION']);
    expect(result.citations[0]!.verified).toBe(false);
  });

  it('does not accept a quote that changes one word of the source', () => {
    const altered = {
      ...good,
      citations: [{ sourceId: 'S1', quote: 'Employees accrue 2.5 vacation days per month.' }],
    };

    const result = processAnswer({ raw: json(altered), finishReason: 'stop', sources });

    expect(result.citations[0]!.verified).toBe(false);
    expect(result.confidence).toBe('low');
  });

  it('warns when an answer cites nothing, and does not trust it', () => {
    const result = processAnswer({
      raw: json({ ...good, citations: [] }),
      finishReason: 'stop',
      sources,
    });

    expect(result.confidence).toBe('low');
    expect(result.warnings).toEqual(['NO_CITATIONS']);
  });

  it('warns when the answer leans on a source it never quoted, and caps confidence', () => {
    const partlyBacked = {
      ...good,
      answer: 'Employees accrue days [S1]. Remote work needs approval [S2].',
    };

    const result = processAnswer({ raw: json(partlyBacked), finishReason: 'stop', sources });

    expect(result.warnings).toEqual(['UNCITED_MARKER']);
    expect(result.confidence).toBe('medium');
  });

  it('reads grouped markers, so [S1, S2] counts as citing both', () => {
    const grouped = {
      ...good,
      answer: 'Employees accrue days and remote work needs approval [S1, S2].',
      citations: [...good.citations, remoteCitation],
    };

    const result = processAnswer({ raw: json(grouped), finishReason: 'stop', sources });

    expect(result.warnings).toEqual([]);
    expect(result.confidence).toBe('high');
  });

  it('flags a marker that points at a source never sent, even when every citation is fine', () => {
    const invented = { ...good, answer: 'Employees accrue days [S1] and get a bonus [S7].' };

    const result = processAnswer({ raw: json(invented), finishReason: 'stop', sources });

    expect(result.warnings).toEqual(['INVALID_SOURCE_REFERENCE']);
    expect(result.citations.map((c) => c.sourceId)).toEqual(['S1']);
    expect(result.confidence).toBe('medium');
  });

  it('flags a citation that points at a source never sent, even when the markers are fine', () => {
    const invented = {
      ...good,
      citations: [
        ...good.citations,
        { sourceId: 'S9', quote: 'Everybody gets a bonus at the end of the year.' },
      ],
    };

    const result = processAnswer({ raw: json(invented), finishReason: 'stop', sources });

    expect(result.warnings).toEqual(['INVALID_SOURCE_REFERENCE']);
    expect(result.citations.map((c) => c.sourceId)).toEqual(['S1']);
    expect(result.confidence).toBe('medium');
  });

  it('keeps at most eight citations', () => {
    const flood = {
      ...good,
      citations: Array.from({ length: 30 }, (_, i) => ({
        sourceId: 'S1',
        quote: `Invented claim number ${i} that appears nowhere`,
      })),
    };

    const result = processAnswer({ raw: json(flood), finishReason: 'stop', sources });

    expect(result.citations).toHaveLength(8);
  });

  it('caps partial answers at medium confidence even when every quote verifies', () => {
    const result = processAnswer({
      raw: json({ ...good, status: 'partially_answered' }),
      finishReason: 'stop',
      sources,
    });

    expect(result).toMatchObject({ status: 'partially_answered', confidence: 'medium' });
  });

  it('treats not_found as "nothing to trust": no citations, no follow-ups, no confidence', () => {
    const notFound = {
      status: 'not_found',
      answer: 'The document does not say.',
      citations: good.citations,
      followUpQuestions: ['Anything else?'],
    };

    const result = processAnswer({ raw: json(notFound), finishReason: 'stop', sources });

    expect(result).toEqual({
      status: 'not_found',
      answer: 'The document does not say.',
      citations: [],
      followUpQuestions: [],
      confidence: 'none',
      warnings: [],
    });
  });

  it('sanitizes the answer and every follow-up question', () => {
    const noisy = {
      ...good,
      answer: `Employees accrue 1.5 vacation days per month [S1].${hidden}\u0000`,
      followUpQuestions: [`Ask${hidden} this?\u0000`, 'Or this?'],
    };

    const result = processAnswer({ raw: json(noisy), finishReason: 'stop', sources });

    expect(result.answer).toBe('Employees accrue 1.5 vacation days per month [S1].');
    expect(result.followUpQuestions).toEqual(['Ask this?', 'Or this?']);
  });

  it('drops blank follow-ups, clamps long ones and keeps three', () => {
    const noisy = {
      ...good,
      followUpQuestions: ['   ', '\u{200B}', 'x'.repeat(500), 'One?', 'Two?', 'Three?', 'Four?'],
    };

    const result = processAnswer({ raw: json(noisy), finishReason: 'stop', sources });

    expect(result.followUpQuestions).toEqual(['x'.repeat(200), 'One?', 'Two?']);
  });

  it('clamps an absurdly long answer and says so', () => {
    const long = { ...good, answer: `${'word '.repeat(2_000)}[S1]` };

    const result = processAnswer({ raw: json(long), finishReason: 'stop', sources });

    expect(result.answer.length).toBeLessThanOrEqual(4_001);
    expect(result.answer.endsWith('…')).toBe(true);
    expect(result.warnings).toContain('TRUNCATED');
  });

  it('never leaves half of an emoji at the clamp boundary of the answer or a follow-up', () => {
    const edge = {
      ...good,
      answer: `${'a'.repeat(3_999)}\u{1F600}x`,
      followUpQuestions: [`${'b'.repeat(199)}\u{1F600}x`],
    };

    const result = processAnswer({ raw: json(edge), finishReason: 'stop', sources });

    expect(result.answer.isWellFormed()).toBe(true);
    expect(result.followUpQuestions[0]!.isWellFormed()).toBe(true);
    expect(result.followUpQuestions[0]!.length).toBeLessThanOrEqual(200);
  });

  it('marks a complete-but-length-limited reply as truncated', () => {
    const result = processAnswer({ raw: json(good), finishReason: 'length', sources });

    expect(result.status).toBe('answered');
    expect(result.warnings).toEqual(['TRUNCATED']);
  });
});

describe('processAnswer: failures never throw, they become typed outcomes', () => {
  it('reports a provider block as declined, whatever text arrived', () => {
    const result = processAnswer({ raw: json(good), finishReason: 'blocked', sources });

    expect(result).toEqual({
      status: 'declined',
      answer: DECLINED_MESSAGE,
      citations: [],
      followUpQuestions: [],
      confidence: 'none',
      warnings: [],
    });
  });

  it('reports malformed JSON as unreadable, keeping the text the user already saw', () => {
    const result = processAnswer({
      raw: '{"answer":"Employees accrue 1.5 vacation da',
      finishReason: 'stop',
      sources,
      streamedAnswer: 'Employees accrue 1.5 vacation da',
    });

    expect(result).toMatchObject({
      status: 'unreadable',
      answer: 'Employees accrue 1.5 vacation da',
      confidence: 'none',
      warnings: ['MALFORMED_OUTPUT'],
    });
  });

  it('sanitizes and bounds the salvaged text as well', () => {
    const dirty = processAnswer({
      raw: 'not json',
      finishReason: 'stop',
      sources,
      streamedAnswer: `Half an answer${hidden}\u0000 here`,
    });
    const huge = processAnswer({
      raw: 'not json',
      finishReason: 'stop',
      sources,
      streamedAnswer: 'word '.repeat(5_000),
    });

    expect(dirty.answer).toBe('Half an answer here');
    expect(huge.answer.length).toBeLessThanOrEqual(4_001);
    expect(huge.answer.endsWith('…')).toBe(true);
  });

  it('falls back to a plain message when there is nothing to salvage', () => {
    const result = processAnswer({ raw: 'not json', finishReason: 'stop', sources });
    expect(result).toMatchObject({ status: 'unreadable', answer: UNREADABLE_MESSAGE });
  });

  it('adds TRUNCATED when the reply was cut off by the token limit mid-JSON', () => {
    const result = processAnswer({
      raw: '{"answer":"cut',
      finishReason: 'length',
      sources,
    });
    expect(result.warnings).toEqual(['MALFORMED_OUTPUT', 'TRUNCATED']);
  });

  it('treats an answer that is empty after cleaning as unreadable', () => {
    const result = processAnswer({
      raw: json({ ...good, answer: '\u{200B}\u0000  ' }),
      finishReason: 'stop',
      sources,
    });
    expect(result.status).toBe('unreadable');
  });

  it('survives a model that loops on newlines until it hits the token limit', () => {
    const started = performance.now();

    const result = processAnswer({
      raw: '```json' + '\n'.repeat(60_000) + 'x',
      finishReason: 'length',
      sources,
    });

    expect(result).toMatchObject({
      status: 'unreadable',
      warnings: ['MALFORMED_OUTPUT', 'TRUNCATED'],
    });
    expect(performance.now() - started).toBeLessThan(500);
  });
});
