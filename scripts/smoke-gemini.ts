import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { AnswerStreamExtractor } from '@/server/ai/postprocess/answer-stream';
import { processAnswer } from '@/server/ai/postprocess/process-answer';
import type { SourceRef } from '@/server/ai/postprocess/types';
import { DOCUMENT_QA_PROMPT_ID } from '@/server/ai/prompts/document-qa/shared';
import { createDefaultPromptRegistry } from '@/server/ai/prompts/registry';
import type { PromptSource } from '@/server/ai/prompts/types';
import { estimateCostUsd, estimateEmbeddingCostUsd } from '@/server/ai/pricing';
import { chunkText } from '@/server/ai/rag/chunker';
import { AiProviderError } from '@/server/ai/providers/errors';
import { GeminiEmbeddingProvider } from '@/server/ai/providers/gemini-embedding';
import { GeminiLlmProvider } from '@/server/ai/providers/gemini-llm';
import type { LlmEvent, LlmProvider, TokenUsage } from '@/server/ai/providers/types';

/** Live Gemini check: `npm run smoke:gemini`. The key is read from .env and never printed. */

type Verdict = 'PASS' | 'WARN' | 'FAIL';
type DoneEvent = Extract<LlmEvent, { type: 'done' }>;

const FIXTURE = resolve('scripts/fixtures/sample-policy.md');
const FIXTURE_TITLE = 'Northwind Employee Handbook';
const SMALL_CHUNKS = { maxChars: 220, overlapChars: 30 };

const verdicts: Verdict[] = [];

function report(verdict: Verdict, label: string, detail?: string): void {
  verdicts.push(verdict);
  console.log(`${verdict.padEnd(4)}  ${label}${detail ? `  (${detail})` : ''}`);
}

const check = (ok: boolean, label: string, detail?: string) =>
  report(ok ? 'PASS' : 'FAIL', label, detail);

function describe(error: unknown): string {
  if (error instanceof AiProviderError)
    return `${error.message}; status ${error.status ?? 'n/a'}, retryable ${error.retryable}`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

async function section(name: string, body: () => Promise<void>): Promise<void> {
  console.log(`\n== ${name}`);
  try {
    await body();
  } catch (error) {
    report('FAIL', `${name} threw`, describe(error));
  }
}

const norm = (vector: readonly number[]) => Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0);
const cosine = (a: readonly number[], b: readonly number[]) => dot(a, b) / (norm(a) * norm(b));

function requireEnv() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      'GEMINI_API_KEY is not set. Put it in .env yourself (never paste it into chat or commit it), then run: npm run smoke:gemini',
    );
    process.exit(2);
  }
  return {
    apiKey,
    llmModel: process.env.LLM_MODEL?.trim() || 'gemini-3.8-flash',
    embeddingModel: process.env.EMBEDDING_MODEL?.trim() || 'gemini-embedding-2',
    promptVersion: process.env.QA_PROMPT_VERSION?.trim() || 'v1',
  };
}

async function checkEmbeddings(embedder: GeminiEmbeddingProvider, chunks: readonly string[]) {
  const documents = await embedder.embed(chunks, 'document', { title: FIXTURE_TITLE });
  check(documents.vectors.length === chunks.length, 'one vector per chunk', `${chunks.length}`);
  check(
    documents.vectors.every((vector) => vector.length === embedder.dimensions),
    `every vector has ${embedder.dimensions} dimensions`,
  );
  const norms = documents.vectors.map(norm);
  const unit = norms.every((n) => Math.abs(n - 1) < 0.01);
  const range = `${Math.min(...norms).toFixed(3)} to ${Math.max(...norms).toFixed(3)}`;
  report(unit ? 'PASS' : 'WARN', 'vectors are unit length', range);

  const questions = [
    ['How many vacation days do I earn each month?', 'vacation'],
    ['Can I work from home?', 'Remote work'],
    ['How much can I claim for meals on a trip?', 'Meals'],
  ] as const;
  const queries = await embedder.embed(
    questions.map(([question]) => question),
    'query',
  );
  questions.forEach(([question, expected], index) => {
    const query = queries.vectors[index] ?? [];
    const scores = documents.vectors.map((vector) => cosine(query, vector));
    const best = scores.indexOf(Math.max(...scores));
    check(
      (chunks[best] ?? '').includes(expected),
      `retrieval: "${question}" ranks a chunk about "${expected}" first`,
      `best score ${(scores[best] ?? 0).toFixed(3)}`,
    );
  });

  const cost = estimateEmbeddingCostUsd(embedder.model, documents.inputTokens);
  console.log(
    `      ~${documents.inputTokens} input tokens, about $${cost?.toFixed(7) ?? 'unknown'}`,
  );
}

async function checkBatchLimits(embedder: GeminiEmbeddingProvider) {
  const production = Array.from(
    { length: 16 },
    (_, i) => `Chunk ${i}. ${'policy text '.repeat(85)}`,
  );
  const result = await embedder.embed(production, 'document', { title: FIXTURE_TITLE });
  check(result.vectors.length === 16, 'a production-shaped batch (16 chunks of ~1000 chars) works');

  for (const count of [32, 64, 100, 128]) {
    const texts = Array.from({ length: count }, (_, i) => `Short smoke chunk number ${i}.`);
    try {
      const batch = await embedder.embed(texts, 'document');
      report(batch.vectors.length === count ? 'PASS' : 'WARN', `batch of ${count} texts accepted`);
    } catch (error) {
      report('WARN', `batch of ${count} texts rejected; keep batches below this`, describe(error));
      break;
    }
  }
}

function toSources(chunks: readonly string[]): SourceRef[] {
  return chunks.map((text, index) => ({
    id: `S${index + 1}`,
    chunkId: `smoke-chunk-${index + 1}`,
    page: null,
    text,
  }));
}

interface AskRun {
  readonly processed: ReturnType<typeof processAnswer>;
  readonly textEvents: number;
  readonly deltaEvents: number;
  readonly ttftMs: number | null;
  readonly totalMs: number;
  readonly done: DoneEvent;
}

function buildRequest(question: string, sources: readonly SourceRef[], promptVersion: string) {
  const template = createDefaultPromptRegistry().get(DOCUMENT_QA_PROMPT_ID, promptVersion);
  const promptSources = sources.map(({ id, page, text }): PromptSource => ({ id, page, text }));
  return template.build({
    question,
    history: [],
    sources: promptSources as [PromptSource, ...PromptSource[]],
    scope: 'full',
    nonce: randomBytes(12).toString('hex'),
  });
}

async function ask(
  llm: LlmProvider,
  question: string,
  sources: readonly SourceRef[],
  promptVersion: string,
): Promise<AskRun> {
  const extractor = new AnswerStreamExtractor();
  const startedAt = performance.now();
  let raw = '';
  let textEvents = 0;
  let deltaEvents = 0;
  let ttftMs: number | null = null;
  let done: DoneEvent | null = null;

  for await (const event of llm.generateStream(buildRequest(question, sources, promptVersion))) {
    if (event.type === 'done') {
      done = event;
      continue;
    }
    textEvents += 1;
    raw += event.text;
    if (extractor.push(event.text)) {
      deltaEvents += 1;
      ttftMs ??= performance.now() - startedAt;
    }
  }
  if (!done) throw new Error('The stream ended without a done event');

  const processed = processAnswer({
    raw,
    finishReason: done.finishReason,
    sources,
    streamedAnswer: extractor.text,
  });
  return {
    processed,
    textEvents,
    deltaEvents,
    ttftMs,
    totalMs: performance.now() - startedAt,
    done,
  };
}

function printMeasurements(model: string, run: AskRun): void {
  const { usage } = run.done;
  const cost = estimateCostUsd(model, usage);
  console.log(`      ${run.textEvents} text events, ${run.deltaEvents} answer deltas`);
  console.log(
    `      tokens in ${usage.inputTokens}, out ${usage.outputTokens}, thinking ${usage.thinkingTokens}; ` +
      `about $${cost?.toFixed(6) ?? 'unknown'} at today's price`,
  );
  console.log(
    `      first answer text ${Math.round(run.ttftMs ?? 0)} ms, complete ${Math.round(run.totalMs)} ms`,
  );
}

function checkUsage(usage: TokenUsage) {
  check(usage.inputTokens > 0, 'usage reports input tokens', `${usage.inputTokens}`);
  check(usage.outputTokens > 0, 'usage reports output tokens', `${usage.outputTokens}`);
  report(
    usage.thinkingTokens > 0 ? 'PASS' : 'WARN',
    'usage reports thinking tokens separately',
    `${usage.thinkingTokens}`,
  );
}

async function checkAnswering(llm: LlmProvider, sources: readonly SourceRef[], version: string) {
  const answerable = await ask(
    llm,
    'How many vacation days do employees accrue per month, and when do unused days expire?',
    sources,
    version,
  );
  printMeasurements(llm.model, answerable);
  const { processed } = answerable;

  check(
    answerable.done.finishReason === 'stop',
    'the model finished normally',
    answerable.done.providerFinishReason ?? '',
  );
  check(answerable.textEvents >= 2, 'the reply streams in several chunks, not one blob');
  report(
    answerable.deltaEvents >= 2 ? 'PASS' : 'WARN',
    'the answer text reaches us incrementally',
    `${answerable.deltaEvents} deltas`,
  );
  const halfway = answerable.totalMs * 0.8;
  report(
    (answerable.ttftMs ?? Infinity) < halfway ? 'PASS' : 'WARN',
    'answer text starts before the stream is nearly over (answer-first key order works)',
  );
  checkUsage(answerable.done.usage);
  check(processed.status === 'answered', 'status is answered', processed.status);
  check(processed.answer.includes('1.5'), 'the answer contains the 1.5 days figure');
  check(
    processed.citations.length > 0 && processed.citations.every((citation) => citation.verified),
    'every citation quotes its source verbatim',
    `${processed.citations.length} citations`,
  );
  check(
    processed.warnings.length === 0,
    'no post-processing warnings',
    processed.warnings.join(', '),
  );
  console.log(`      confidence ${processed.confidence}; answer: ${processed.answer}`);

  const unanswerable = await ask(llm, 'What is the parental leave policy?', sources, version);
  report(
    unanswerable.processed.status === 'not_found' ? 'PASS' : 'WARN',
    'an unanswerable question comes back not_found',
    unanswerable.processed.status,
  );
}

async function checkAbort(llm: LlmProvider, sources: readonly SourceRef[], version: string) {
  const controller = new AbortController();
  const request = {
    ...buildRequest(
      'Explain every policy in the handbook in as much detail as you can, section by section.',
      sources,
      version,
    ),
    signal: controller.signal,
  };
  const startedAt = performance.now();
  try {
    for await (const event of llm.generateStream(request))
      if (event.type === 'text' && !controller.signal.aborted) controller.abort();
    report('WARN', 'abort: the stream finished before the abort could take effect');
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    const elapsed = Math.round(performance.now() - startedAt);
    check(aborted, 'aborting a live stream raises AbortError', describe(error));
    check(elapsed < 10_000, 'the aborted stream stops promptly', `${elapsed} ms`);
  }
}

async function expectRejection(
  label: string,
  llm: LlmProvider,
  sources: readonly SourceRef[],
  version: string,
  statuses: readonly number[],
) {
  try {
    for await (const event of llm.generateStream(buildRequest('Ping?', sources, version)))
      void event;
    report('FAIL', `${label}: expected a failure but the call succeeded`);
  } catch (error) {
    const matches =
      error instanceof AiProviderError &&
      !error.retryable &&
      error.status !== undefined &&
      statuses.includes(error.status);
    check(matches, `${label} becomes a non-retryable AiProviderError`, describe(error));
  }
}

async function main(): Promise<void> {
  const env = requireEnv();
  const fixture = await readFile(FIXTURE, 'utf8');
  const chunks = chunkText(fixture, SMALL_CHUNKS).map((chunk) => chunk.text);
  const sources = toSources(chunks);

  const embedder = new GeminiEmbeddingProvider({ apiKey: env.apiKey, model: env.embeddingModel });
  const llm = new GeminiLlmProvider({ apiKey: env.apiKey, model: env.llmModel });
  console.log(
    `LLM ${env.llmModel} | embeddings ${env.embeddingModel} | prompt ${env.promptVersion}`,
  );
  console.log(`Fixture split into ${chunks.length} chunks (${SMALL_CHUNKS.maxChars} chars each)`);

  await section('Embeddings', () => checkEmbeddings(embedder, chunks));
  await section('Embedding batch limits', () => checkBatchLimits(embedder));
  await section('Grounded answers (real prompt, schema and post-processing)', () =>
    checkAnswering(llm, sources, env.promptVersion),
  );
  await section('Abort on a live stream', () => checkAbort(llm, sources, env.promptVersion));
  await section('Error classification', async () => {
    const wrongModel = new GeminiLlmProvider({
      apiKey: env.apiKey,
      model: 'gemini-does-not-exist',
    });
    const wrongKey = new GeminiLlmProvider({ apiKey: 'not-a-real-key', model: env.llmModel });
    await expectRejection('an unknown model', wrongModel, sources, env.promptVersion, [404]);
    await expectRejection(
      'an invalid API key',
      wrongKey,
      sources,
      env.promptVersion,
      [400, 401, 403],
    );
  });

  const failed = verdicts.filter((verdict) => verdict === 'FAIL').length;
  const warned = verdicts.filter((verdict) => verdict === 'WARN').length;
  console.log(
    `\n${verdicts.length - failed - warned} passed, ${warned} warnings, ${failed} failed`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(describe(error));
  process.exit(1);
});
