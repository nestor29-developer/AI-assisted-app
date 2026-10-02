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
  status: 'answered',
  answer: 'Employees accrue 1.5 vacation days per month [S1].',
  citations: [{ sourceId: 'S1', quote: 'Employees accrue 1.5 vacation days per month.' }],
  followUpQuestions: ['When do unused days expire?'],
};

describe('parseAnswer', () => {
  it('accepts valid JSON, fenced JSON and fills missing lists', () => {
    expect(parseAnswer(json(good)).ok).toBe(true);
    expect(parseAnswer('```json\n' + json(good) + '\n```').ok).toBe(true);

    const minimal = parseAnswer(json({ status: 'not_found', answer: 'No.' }));
    expect(minimal).toMatchObject({ ok: true, payload: { citations: [], followUpQuestions: [] } });
  });

  it.each([
    ['empty text', '', 'empty'],
    ['whitespace only', '  \n ', 'empty'],
    ['truncated JSON', '{"status":"answered","answer":"cut o', 'invalid_json'],
    ['plain prose', 'Sure! The answer is 42.', 'invalid_json'],
    ['an unknown status', json({ ...good, status: 'maybe' }), 'schema_mismatch'],
    ['a missing answer', json({ status: 'answered' }), 'schema_mismatch'],
    ['a non-object', '["answer"]', 'schema_mismatch'],
  ])('rejects %s', (_label, raw, reason) => {
    expect(parseAnswer(raw)).toEqual({ ok: false, reason });
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

  it('warns when an answer cites nothing, and does not trust it', () => {
    const result = processAnswer({
      raw: json({ ...good, citations: [] }),
      finishReason: 'stop',
      sources,
    });

    expect(result.confidence).toBe('low');
    expect(result.warnings).toEqual(['NO_CITATIONS']);
  });

  it('warns about source markers or citations that point at sources never sent', () => {
    const invented = {
      ...good,
      answer: 'Employees accrue days [S1] and also get a bonus [S7].',
      citations: [
        ...good.citations,
        { sourceId: 'S9', quote: 'Everybody gets a bonus at the end of the year.' },
      ],
    };

    const result = processAnswer({ raw: json(invented), finishReason: 'stop', sources });

    expect(result.warnings).toEqual(['INVALID_SOURCE_REFERENCE']);
    expect(result.citations.map((c) => c.sourceId)).toEqual(['S1']);
    expect(result.confidence).toBe('high');
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

  it('sanitizes and bounds everything that came from the model', () => {
    const hidden = String.fromCodePoint(0xe0049, 0xe004e);
    const noisy = {
      ...good,
      answer: `Employees accrue 1.5 vacation days per month [S1].${hidden}\u0000`,
      followUpQuestions: ['One?', 'Two?', 'Three?', 'Four?', `${'x'.repeat(500)}`, '   '],
    };

    const result = processAnswer({ raw: json(noisy), finishReason: 'stop', sources });

    expect(result.answer).toBe('Employees accrue 1.5 vacation days per month [S1].');
    expect(result.followUpQuestions).toHaveLength(3);
    expect(result.followUpQuestions.every((q) => q.length <= 200)).toBe(true);
  });

  it('clamps an absurdly long answer and says so', () => {
    const long = { ...good, answer: `${'word '.repeat(2_000)}[S1]` };

    const result = processAnswer({ raw: json(long), finishReason: 'stop', sources });

    expect(result.answer.length).toBeLessThanOrEqual(4_001);
    expect(result.answer.endsWith('…')).toBe(true);
    expect(result.warnings).toContain('TRUNCATED');
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
      raw: '{"status":"answered","answer":"Employees accrue 1.5 vacation da',
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

  it('falls back to a plain message when there is nothing to salvage', () => {
    const result = processAnswer({ raw: 'not json', finishReason: 'stop', sources });
    expect(result).toMatchObject({ status: 'unreadable', answer: UNREADABLE_MESSAGE });
  });

  it('adds TRUNCATED when the reply was cut off by the token limit mid-JSON', () => {
    const result = processAnswer({
      raw: '{"status":"answered","answer":"cut',
      finishReason: 'length',
      sources,
    });
    expect(result.warnings).toEqual(['MALFORMED_OUTPUT', 'TRUNCATED']);
  });

  it('treats an answer that is empty after cleaning as unreadable', () => {
    const result = processAnswer({
      raw: json({ ...good, answer: '​\u0000  ' }),
      finishReason: 'stop',
      sources,
    });
    expect(result.status).toBe('unreadable');
  });
});
