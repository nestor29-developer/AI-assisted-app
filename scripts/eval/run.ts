import { randomUUID } from 'node:crypto';

import { estimateCostUsd } from '@/server/ai/pricing';
import { createDefaultPromptRegistry } from '@/server/ai/prompts/registry';
import type { AiProviders } from '@/server/ai/providers/factory';
import { createLogger } from '@/server/core/logger';
import { ChatService } from '@/server/modules/chat/chat.service';
import { ContextSelector } from '@/server/modules/chat/context-selector';
import { DocumentService } from '@/server/modules/documents/document.service';
import { UsageService } from '@/server/modules/usage/usage.service';
import type { MessageDto } from '@/shared/contracts/messages';
import { InMemoryAiRequestRepository } from '@/test/fakes/ai-request-repository';
import { InMemoryDocumentStore } from '@/test/fakes/document-store';
import { InMemoryMessageRepository } from '@/test/fakes/message-repository';
import { InMemoryRateLimiter } from '@/test/fakes/rate-limiter';

import type { EvalCase } from './golden';
import type { Outcome, Retrieval } from './score';
import { hasWords } from './text';

export interface Setup {
  readonly providers: AiProviders;
  readonly promptVersion: string;
  readonly ragTopK: number;
  readonly fullContextMaxTokens: number;
  /** Makes a model's output repeatable where it supports it. */
  readonly seed?: number;
}

export interface Run {
  readonly caseId: string;
  readonly repeat: number;
  /** Null when the question failed before an answer existed. */
  readonly outcome: (Outcome & { readonly confidence: string }) | null;
  /** Null when the case names no evidence to look for. */
  readonly retrieval: Retrieval | null;
  readonly failure: string | null;
  readonly ttftMs: number | null;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number | null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Reads a stream to its end; the reply is what the service stores, not what we keep here. */
async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const event of stream) void event;
}

/** The real services over in-memory stores (no database); each question gets an empty conversation. */
function createHarness(setup: Setup, texts: ReadonlyMap<string, string>) {
  const { llm, embeddings } = setup.providers;
  const logger = createLogger({ level: 'silent', version: 'eval' });
  const store = new InMemoryDocumentStore();
  const aiRequests = new InMemoryAiRequestRepository();
  const rateLimiter = new InMemoryRateLimiter();
  const userId = randomUUID();

  const uploads = new DocumentService({
    documents: store,
    embeddings,
    aiRequests: new InMemoryAiRequestRepository(),
    rateLimiter: new InMemoryRateLimiter(),
    logger,
    config: {
      maxPdfPages: 100,
      maxDocumentChars: 400_000,
      uploadsPerHour: 10_000,
      documentRetentionDays: 1,
      appVersion: 'eval',
    },
  });
  const uploaded = new Map<string, Promise<string>>();
  const documentId = (key: string): Promise<string> => {
    const text = texts.get(key);
    if (text === undefined) throw new Error(`No document named ${key}`);
    if (!uploaded.has(key)) {
      uploaded.set(
        key,
        uploads.createFromText(userId, { title: key, text }).then(({ id }) => id),
      );
    }
    return uploaded.get(key)!;
  };

  const selector = new ContextSelector(store, embeddings, {
    fullContextMaxTokens: setup.fullContextMaxTokens,
    topK: setup.ragTopK,
  });

  const chat = (messages: InMemoryMessageRepository) =>
    new ChatService({
      documents: store,
      messages,
      selector,
      llm,
      prompts: createDefaultPromptRegistry(),
      usage: new UsageService(aiRequests, {
        maxConcurrent: 10,
        dailyBudgetTokens: 1_000_000_000,
        windowSeconds: 86_400,
        staleAfterSeconds: 3_600,
      }),
      aiRequests,
      rateLimiter,
      logger,
      config: {
        promptVersion: setup.promptVersion,
        askPerMinute: 100_000,
        injectionPolicy: 'flag',
        llmTimeoutMs: 120_000,
        appVersion: 'eval',
        ragTopK: setup.ragTopK,
        fullContextMaxTokens: setup.fullContextMaxTokens,
        ...(setup.seed === undefined ? {} : { llmSeed: setup.seed }),
      },
    });

  /** Where the passage with the answer ranks among what retrieval returns, asked of the selector directly. */
  const retrievals = new Map<string, Promise<Retrieval | null>>();
  const retrieve = (testCase: EvalCase): Promise<Retrieval | null> => {
    const evidence = testCase.kind === 'unanswerable' ? undefined : testCase.evidence;
    if (evidence === undefined) return Promise.resolve(null);
    if (!retrievals.has(testCase.id)) {
      retrievals.set(
        testCase.id,
        (async (): Promise<Retrieval> => {
          const id = await documentId(testCase.document);
          const document = await store.findById(userId, id);
          if (!document) throw new Error(`Document ${testCase.document} disappeared`);
          const { strategy, sources } = await selector.select({
            document,
            question: testCase.question,
            previousQuestion: testCase.turns?.at(-1) ?? null,
          });
          if (strategy === 'full') return { strategy, rank: null };
          const ranked = [...sources].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
          const index = ranked.findIndex((source) => hasWords(source.text, evidence));
          return { strategy, rank: index === -1 ? null : index + 1 };
        })(),
      );
    }
    return retrievals.get(testCase.id)!;
  };

  return {
    async ask(testCase: EvalCase, repeat: number): Promise<Run> {
      const started = performance.now();
      let ttftMs: number | null = null;
      let reply: MessageDto | null = null;
      let failure: string | null = null;
      let retrieval: Retrieval | null = null;
      try {
        const id = await documentId(testCase.document);
        retrieval = await retrieve(testCase);
        const service = chat(new InMemoryMessageRepository());
        const ask = (question: string) =>
          service.ask({
            userId,
            documentId: id,
            question,
            requestId: randomUUID(),
            instance: '/eval',
          });
        for (const turn of testCase.turns ?? []) await drain(ask(turn));

        const stream = ask(testCase.question);
        for await (const event of stream) {
          if (event.type === 'delta') ttftMs ??= performance.now() - started;
          else if (event.type === 'final') reply = event.message;
          else if (event.type === 'error') {
            failure = `${event.problem.code}: ${event.problem.detail ?? event.problem.title}`;
          }
        }
      } catch (error) {
        failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      }

      const answer = reply?.answer ?? null;
      if (!answer && !failure) failure = 'The reply carried no answer';
      if (!answer) {
        const latencyMs = Math.round(performance.now() - started);
        return {
          caseId: testCase.id,
          repeat,
          outcome: null,
          retrieval,
          failure,
          ttftMs,
          latencyMs,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: null,
        };
      }

      const { meta } = answer;
      return {
        caseId: testCase.id,
        repeat,
        outcome: {
          status: answer.status,
          answer: answer.answer,
          confidence: answer.confidence,
          citations: answer.citations.map(({ sourceId, quote }) => ({ sourceId, quote })),
          followUps: answer.followUpQuestions,
          warnings: answer.warnings,
          sources: answer.sources.map(({ id, text }) => ({ id, text })),
        },
        retrieval,
        failure,
        ttftMs,
        latencyMs: meta.latencyMs,
        inputTokens: meta.inputTokens,
        outputTokens: meta.outputTokens,
        costUsd: estimateCostUsd(meta.model, {
          inputTokens: meta.inputTokens,
          outputTokens: meta.outputTokens,
          thinkingTokens: 0,
        }),
      };
    },
  };
}

export interface RunOptions {
  readonly repeats: number;
  /** Pause between questions, to stay under a provider's requests-per-minute limit. */
  readonly delayMs: number;
  readonly onRun?: (run: Run, testCase: EvalCase) => void;
}

export async function runAll(
  setup: Setup,
  texts: ReadonlyMap<string, string>,
  cases: readonly EvalCase[],
  { repeats, delayMs, onRun }: RunOptions,
): Promise<Run[]> {
  const harness = createHarness(setup, texts);
  const runs: Run[] = [];
  for (const testCase of cases) {
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      const run = await harness.ask(testCase, repeat);
      runs.push(run);
      onRun?.(run, testCase);
      if (delayMs > 0) await sleep(delayMs);
    }
  }
  return runs;
}
