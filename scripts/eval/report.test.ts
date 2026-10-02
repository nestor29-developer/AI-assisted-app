import { describe, expect, it } from 'vitest';

import type { EvalCase, Thresholds } from './golden';
import { formatComparison, formatResult, formatRun, passed, summarize } from './report';
import type { Run } from './run';

const thresholds: Thresholds = {
  schemaValid: 1,
  citationsVerified: 0.9,
  keywordRecall: 0.9,
  retrievalHit: 0.9,
  notFoundAccuracy: 0.8,
  injectionResistance: 1,
};

const cases = new Map<string, EvalCase>([
  [
    'a',
    {
      id: 'a',
      document: 'd',
      kind: 'answerable',
      question: 'Q?',
      mustContain: [['yes']],
      evidence: 'evidence text',
    },
  ],
  ['b', { id: 'b', document: 'd', kind: 'unanswerable', question: 'Q?' }],
]);

const run = (overrides: Partial<Run> & { caseId: string }): Run => ({
  repeat: 1,
  outcome: {
    status: 'answered',
    confidence: 'high',
    answer: 'yes it is',
    citations: [{ verified: true }],
    warnings: [],
    sourceTexts: ['some evidence text here'],
  },
  failure: null,
  ttftMs: 100,
  latencyMs: 1_000,
  inputTokens: 1_000,
  outputTokens: 100,
  costUsd: 0.002,
  ...overrides,
});

const identity = {
  label: 'mock v1',
  provider: 'mock',
  model: 'mock-extractive-1',
  promptVersion: 'v1',
};

describe('summarize', () => {
  it('scores each run against its case and totals tokens, cost and latency percentiles', () => {
    const runs = [
      run({ caseId: 'a', latencyMs: 1_000 }),
      run({
        caseId: 'b',
        latencyMs: 3_000,
        outcome: { ...run({ caseId: 'b' }).outcome!, status: 'not_found', citations: [] },
      }),
    ];

    const result = summarize(identity, runs, cases, thresholds);

    expect(result.metrics.notFoundAccuracy).toBe(1);
    expect(result.metrics.retrievalHit).toBe(1);
    expect(result.totals).toMatchObject({
      inputTokens: 2_000,
      outputTokens: 200,
      latencyP50Ms: 1_000,
      latencyP95Ms: 3_000,
      ttftP50Ms: 100,
    });
    expect(result.totals.costUsd).toBeCloseTo(0.004, 6);
    expect(passed(result)).toBe(true);
  });

  it('counts questions that failed before an answer, leaves them out of the metrics, and fails the run', () => {
    const runs = [
      run({ caseId: 'a' }),
      run({ caseId: 'b', outcome: null, failure: 'AI_UNAVAILABLE: down' }),
    ];

    const result = summarize(identity, runs, cases, thresholds);

    expect(result.errors).toBe(1);
    expect(result.metrics.notFoundAccuracy).toBeNull();
    expect(passed(result)).toBe(false);
  });

  it('reports an unknown total cost rather than a misleading partial one', () => {
    const runs = [run({ caseId: 'a' }), run({ caseId: 'b', costUsd: null })];

    expect(summarize(identity, runs, cases, thresholds).totals.costUsd).toBeNull();
  });

  it('refuses a run for a case it does not know', () => {
    expect(() => summarize(identity, [run({ caseId: 'zzz' })], cases, thresholds)).toThrow(
      /unknown case zzz/,
    );
  });

  it('records the threshold failures', () => {
    const runs = [
      run({ caseId: 'a', outcome: { ...run({ caseId: 'a' }).outcome!, answer: 'no idea' } }),
    ];

    const result = summarize(identity, runs, cases, thresholds);

    expect(result.failures.map((failure) => failure.metric)).toEqual(['keywordRecall']);
    expect(passed(result)).toBe(false);
  });
});

describe('formatting', () => {
  it('shows what came back and which checks passed or failed, one line per question', () => {
    const result = summarize(
      identity,
      [run({ caseId: 'a' }), run({ caseId: 'b' })],
      cases,
      thresholds,
    );

    const [good, bad] = result.runs.map(formatRun);

    expect(good).toMatch(
      /^a\s+answerable\s+answered\/high\s+\+schema\s+\+quotes\s+\+retrieval\s+recall 1\.00$/,
    );
    expect(bad).toMatch(/^b\s+unanswerable\s+answered\/high\s+\+schema\s+-refused$/);
  });

  it('marks failed questions and repeated runs', () => {
    const result = summarize(
      identity,
      [run({ caseId: 'a', repeat: 3, outcome: null, failure: 'RATE_LIMITED: slow down' })],
      cases,
      thresholds,
    );

    expect(formatRun(result.runs[0]!)).toMatch(
      /^a#3\s+answerable\s+FAILED\s+RATE_LIMITED: slow down$/,
    );
  });

  it('prints each metric against its threshold, with FAIL where it falls short', () => {
    const result = summarize(
      identity,
      [run({ caseId: 'a', outcome: { ...run({ caseId: 'a' }).outcome!, answer: 'no idea' } })],
      cases,
      thresholds,
    );

    const text = formatResult(result, thresholds);

    expect(text).toContain('== mock v1');
    expect(text).toMatch(/keywordRecall\s+0\.0%\s+needs\s+90\.0%\s+FAIL/);
    expect(text).toMatch(/schemaValid\s+100\.0%\s+needs\s+100\.0%\s+pass/);
    expect(text).toMatch(/notFoundAccuracy\s+n\/a/);
    expect(text).toContain('tokens in/out 1,000 / 100');
  });

  it('compares configurations side by side, and prints nothing for a single one', () => {
    const one = summarize(identity, [run({ caseId: 'a' })], cases, thresholds);
    const two = summarize(
      { ...identity, label: 'mock v2', promptVersion: 'v2' },
      [run({ caseId: 'a' })],
      cases,
      thresholds,
    );

    expect(formatComparison([one])).toBe('');
    const table = formatComparison([one, two]);
    expect(table).toContain('mock v1');
    expect(table).toContain('mock v2');
    expect(table).toMatch(/keywordRecall\s+100\.0%\s+100\.0%/);
    expect(table).toMatch(/estimated cost\s+\$0\.0020\s+\$0\.0020/);
  });
});
