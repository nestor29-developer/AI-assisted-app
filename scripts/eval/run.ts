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
import type { Outcome } from './score';

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
  readonly failure: string | null;
  readonly ttftMs: number | null;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number | null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

  const chat = () =>
    new ChatService({
      documents: store,
      messages: new InMemoryMessageRepository(),
      selector: new ContextSelector(store, embeddings, {
        fullContextMaxTokens: setup.fullContextMaxTokens,
        topK: setup.ragTopK,
      }),
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

  return {
    async ask(testCase: EvalCase, repeat: number): Promise<Run> {
      const started = performance.now();
      let ttftMs: number | null = null;
      let reply: MessageDto | null = null;
      let failure: string | null = null;
      try {
        const stream = chat().ask({
          userId,
          documentId: await documentId(testCase.document),
          question: testCase.question,
          requestId: randomUUID(),
          instance: '/eval',
        });
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
          citations: answer.citations,
          warnings: answer.warnings,
          sourceTexts: answer.sources.map((source) => source.text),
        },
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
