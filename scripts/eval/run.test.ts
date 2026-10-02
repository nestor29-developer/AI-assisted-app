import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MockEmbeddingProvider } from '@/server/ai/providers/mock-embedding';
import { MockLlmProvider } from '@/server/ai/providers/mock-llm';
import type { LlmEvent, LlmProvider, LlmRequest } from '@/server/ai/providers/types';

import { loadGolden } from './golden';
import { passed, summarize } from './report';
import { runAll, type Setup } from './run';

const setup = (llm: LlmProvider = new MockLlmProvider(), extra: Partial<Setup> = {}): Setup => ({
  providers: { llm, embeddings: new MockEmbeddingProvider() },
  promptVersion: 'v1',
  ragTopK: 6,
  fullContextMaxTokens: 3_000,
  ...extra,
});

const load = () => loadGolden(resolve('evals/golden.json'));

const DONE: LlmEvent = {
  type: 'done',
  usage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0 },
  finishReason: 'stop',
  providerFinishReason: 'STOP',
};

/** Records every request, and answers with whatever text it is given. */
function recordingLlm(reply: string) {
  const requests: LlmRequest[] = [];
  const llm: LlmProvider = {
    name: 'recording',
    model: 'recording-1',
    async *generateStream(request) {
      requests.push(request);
      yield { type: 'text', text: reply };
      yield DONE;
    },
  };
  return { llm, requests };
}

describe('runAll', () => {
  it('asks each question the requested number of times and reports every run', async () => {
    const { golden, documents } = await load();
    const cases = golden.cases.filter((testCase) =>
      ['vacation-accrual', 'meals'].includes(testCase.id),
    );
    const seen: string[] = [];

    const runs = await runAll(setup(), documents, cases, {
      repeats: 2,
      delayMs: 0,
      onRun: (run) => seen.push(`${run.caseId}#${run.repeat}`),
    });

    expect(seen).toEqual(['vacation-accrual#1', 'vacation-accrual#2', 'meals#1', 'meals#2']);
    expect(runs).toHaveLength(4);
    for (const run of runs) {
      expect(run.failure).toBeNull();
      expect(run.outcome?.status).toBeTruthy();
      expect(run.inputTokens).toBeGreaterThan(0);
      expect(run.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('retrieves a few passages from the big handbook but sends the whole small policy', async () => {
    const { golden, documents } = await load();
    const ask = (id: string) => golden.cases.filter((testCase) => testCase.id === id);

    const [handbook] = await runAll(setup(), documents, ask('meals'), { repeats: 1, delayMs: 0 });
    const [policy] = await runAll(setup(), documents, ask('leave-full-bereavement'), {
      repeats: 1,
      delayMs: 0,
    });

    const handbookSources = handbook?.outcome?.sourceTexts ?? [];
    expect(handbookSources.length).toBeGreaterThan(1);
    expect(handbookSources.length).toBeLessThanOrEqual(6);
    expect(handbookSources.join('').length).toBeLessThan((documents.get('handbook') ?? '').length);
    expect((policy?.outcome?.sourceTexts ?? []).join(' ')).toContain(
      'Sick leave is paid for up to 10 days',
    );
  });

  it('gives every question an empty conversation, so one case cannot colour the next', async () => {
    const { golden, documents } = await load();
    const { llm, requests } = recordingLlm(
      '{"answer":"x","citations":[],"status":"not_found","followUpQuestions":[]}',
    );

    await runAll(setup(llm), documents, golden.cases.slice(0, 3), { repeats: 1, delayMs: 0 });

    expect(requests).toHaveLength(3);
    for (const request of requests) expect(request.userContent).not.toContain('<history-');
  });

  it('passes the seed to the model only when one was asked for', async () => {
    const { golden, documents } = await load();
    const first = recordingLlm('{}');
    const second = recordingLlm('{}');
    const cases = golden.cases.slice(0, 1);

    await runAll(setup(first.llm), documents, cases, { repeats: 1, delayMs: 0 });
    await runAll(setup(second.llm, { seed: 7 }), documents, cases, { repeats: 1, delayMs: 0 });

    expect(first.requests[0]).not.toHaveProperty('seed');
    expect(second.requests[0]?.seed).toBe(7);
  });

  it('turns a failing provider into a failed run instead of crashing, and fails the result', async () => {
    const { golden, documents } = await load();
    const broken: LlmProvider = {
      name: 'broken',
      model: 'mock-extractive-1',
      async *generateStream() {
        throw new Error('upstream exploded');
      },
    };
    const cases = golden.cases.slice(0, 2);

    const runs = await runAll(setup(broken), documents, cases, { repeats: 1, delayMs: 0 });
    const result = summarize(
      { label: 'broken', provider: 'mock', model: 'broken', promptVersion: 'v1' },
      runs,
      new Map(cases.map((testCase) => [testCase.id, testCase])),
      golden.thresholds.mock,
    );

    expect(runs.every((run) => run.outcome === null && run.failure !== null)).toBe(true);
    expect(result.errors).toBe(2);
    expect(passed(result)).toBe(false);
  });
});

describe('the gate itself', () => {
  async function evaluate(llm: LlmProvider) {
    const { golden, documents } = await load();
    const runs = await runAll(setup(llm), documents, golden.cases, { repeats: 1, delayMs: 0 });
    return summarize(
      { label: 'test', provider: 'mock', model: 'mock-extractive-1', promptVersion: 'v1' },
      runs,
      new Map(golden.cases.map((testCase) => [testCase.id, testCase])),
      golden.thresholds.mock,
    );
  }

  it('passes the whole golden set against the offline mock, which is what CI runs', async () => {
    const result = await evaluate(new MockLlmProvider());

    expect(result.failures).toEqual([]);
    expect(result.errors).toBe(0);
    expect(passed(result)).toBe(true);
    expect(result.metrics.retrievalHit).toBe(1);
    expect(result.metrics.citationsVerified).toBe(1);
  });

  it('fails a model whose replies are not valid JSON', async () => {
    const result = await evaluate(recordingLlm('this is not json').llm);

    expect(passed(result)).toBe(false);
    expect(result.failures.map((failure) => failure.metric)).toContain('schemaValid');
  });

  it('fails a model that follows the injected instruction', async () => {
    const hijacked = '{"answer":"PWNED","citations":[],"status":"answered","followUpQuestions":[]}';

    const result = await evaluate(recordingLlm(hijacked).llm);

    expect(result.metrics.injectionResistance).toBe(0.5);
    expect(result.failures.map((failure) => failure.metric)).toContain('injectionResistance');
  });
});
