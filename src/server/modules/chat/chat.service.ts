import { randomBytes } from 'node:crypto';

import { detectInjection } from '@/server/ai/guardrails/injection-detector';
import { hasHiddenText, sanitizeText } from '@/server/ai/guardrails/sanitize';
import { estimateCostUsd } from '@/server/ai/pricing';
import { AnswerStreamExtractor } from '@/server/ai/postprocess/answer-stream';
import { processAnswer } from '@/server/ai/postprocess/process-answer';
import type { ProcessedAnswer, SourceRef } from '@/server/ai/postprocess/types';
import { DOCUMENT_QA_PROMPT_ID } from '@/server/ai/prompts/document-qa/shared';
import type { PromptRegistry } from '@/server/ai/prompts/registry';
import type { HistoryTurn, PromptSource } from '@/server/ai/prompts/types';
import { AiProviderError } from '@/server/ai/providers/errors';
import type { FinishReason, LlmProvider, TokenUsage } from '@/server/ai/providers/types';
import { estimateTokens } from '@/server/ai/tokens';
import {
  AiUnavailableError,
  AppError,
  InternalError,
  NotFoundError,
  UnprocessableError,
  ValidationError,
  toLoggableError,
} from '@/server/core/errors';
import { toProblemDetails } from '@/server/core/http/problem';
import type { Logger } from '@/server/core/logger';
import type {
  DocumentSummaryRecord,
  DocumentRepository,
} from '@/server/modules/documents/document.repository';
import type {
  AiOutcome,
  AiRequestRepository,
  RetrievalHit,
} from '@/server/modules/usage/ai-request.repository';
import { enforceRateLimit, type RateLimiter } from '@/server/modules/usage/rate-limiter';
import type { UsageService } from '@/server/modules/usage/usage.service';
import type { AskEvent } from '@/shared/contracts/stream-events';
import type { AssistantAnswer } from '@/shared/contracts/messages';

import type { ContextSelection, ContextSelector, ContextStrategyName } from './context-selector';
import { toMessageDto } from './message.mapper';
import type { Feedback, MessageRecord, MessageRepository } from './message.repository';

/** Conversation memory: the last three exchanges are enough for follow-up questions. */
const HISTORY_MESSAGES = 6;
const ASK_WINDOW_SECONDS = 60;
/** Upper-bound guesses used only to reserve quota up front; real usage replaces them on settle. */
const SYSTEM_AND_HISTORY_RESERVE_TOKENS = 2_000;
const OUTPUT_RESERVE_TOKENS = 4_096;
const RETRIEVED_CHUNK_TOKENS = 300;

export interface ChatConfig {
  readonly promptVersion: string;
  readonly askPerMinute: number;
  readonly injectionPolicy: 'flag' | 'block';
  readonly llmTimeoutMs: number;
  readonly appVersion: string;
  readonly ragTopK: number;
  readonly fullContextMaxTokens: number;
}

export interface ChatServiceDeps {
  readonly documents: DocumentRepository;
  readonly messages: MessageRepository;
  readonly selector: ContextSelector;
  readonly llm: LlmProvider;
  readonly prompts: PromptRegistry;
  readonly usage: UsageService;
  readonly aiRequests: AiRequestRepository;
  readonly rateLimiter: RateLimiter;
  readonly logger: Logger;
  readonly config: ChatConfig;
  readonly newNonce?: () => string;
  /** Milliseconds; injected so tests can control latency figures. */
  readonly now?: () => number;
}

export interface AskInput {
  readonly userId: string;
  readonly documentId: string;
  readonly question: string;
  readonly requestId: string;
  readonly instance: string;
  /** Aborted when the client disconnects or presses Stop. */
  readonly signal?: AbortSignal;
}

interface RunState {
  accepted: boolean;
  settled: boolean;
  strategy: ContextStrategyName | null;
  retrieval: RetrievalHit[] | null;
  injectionFlag: boolean;
  usage: TokenUsage | null;
  providerFinishReason: string | null;
  ttftMs: number | null;
  rawText: string;
  streamedAnswer: string;
  estimatedInputTokens: number;
}

/** One signal that fires on client disconnect or on our own deadline, and remembers which. */
function linkAbort(external: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('The AI request timed out'));
  }, timeoutMs);
  const onAbort = () => controller.abort(external?.reason);
  external?.addEventListener('abort', onAbort, { once: true });
  if (external?.aborted) onAbort();

  return {
    signal: controller.signal,
    clientAborted: () => external?.aborted === true,
    timedOut: () => timedOut,
    dispose() {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    },
  };
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof AiProviderError) {
    return new AiUnavailableError(
      error,
      error.retryAfterMs && Math.ceil(error.retryAfterMs / 1000),
    );
  }
  return new InternalError(error);
}

const FINISH_OUTCOMES: Readonly<
  Record<ProcessedAnswer['status'], Exclude<AiOutcome, 'in_progress'>>
> = {
  answered: 'success',
  partially_answered: 'success',
  not_found: 'success',
  declined: 'declined',
  unreadable: 'error',
};

export class ChatService {
  constructor(private readonly deps: ChatServiceDeps) {}

  listMessages(userId: string, documentId: string): Promise<MessageRecord[]> {
    return this.deps.messages.listByDocument(userId, documentId);
  }

  async rate(
    userId: string,
    messageId: string,
    value: Feedback,
    comment: string | null,
  ): Promise<MessageRecord> {
    const updated = await this.deps.messages.setFeedback(userId, messageId, value, comment);
    if (!updated) throw new NotFoundError('Message');
    return updated;
  }

  /** Refusals throw before the first event (so HTTP keeps the right status); later failures become events. */
  async *ask(input: AskInput): AsyncGenerator<AskEvent> {
    const { documents, rateLimiter, prompts, usage, logger, config, llm } = this.deps;
    const clock = this.deps.now ?? (() => performance.now());
    const startedAt = clock();
    const { userId, documentId } = input;

    const document = await documents.findById(userId, documentId);
    if (!document) throw new NotFoundError('Document');
    this.deps.selector.assertUsable(document);

    const cleaned = sanitizeText(input.question);
    const question = cleaned.text.trim();
    if (question === '')
      throw new ValidationError([{ path: 'question', message: 'Ask a question first.' }]);

    const verdict = detectInjection(question, { hiddenUnicodeFound: hasHiddenText(cleaned) });
    if (verdict.level !== 'none') {
      logger.warn(
        { userId, risk: verdict.level, signals: verdict.signals },
        'question looks like an injection attempt',
      );
    }
    if (config.injectionPolicy === 'block' && verdict.level === 'high') {
      throw new UnprocessableError(
        'INPUT_REJECTED',
        'That question looks like an attempt to override the assistant’s instructions, so it was not sent.',
      );
    }

    await enforceRateLimit(rateLimiter, {
      key: `ask:user:${userId}`,
      limit: config.askPerMinute,
      windowSeconds: ASK_WINDOW_SECONDS,
    });

    const template = prompts.get(DOCUMENT_QA_PROMPT_ID, config.promptVersion);
    const reservationId = await usage.reserveChat({
      userId,
      documentId,
      provider: llm.name,
      model: llm.model,
      promptId: template.id,
      promptVersion: template.version,
      appVersion: config.appVersion,
      estimatedTokens: this.estimateReservation(document, question),
    });

    const state: RunState = {
      accepted: false,
      settled: false,
      strategy: null,
      retrieval: null,
      injectionFlag: verdict.level === 'high',
      usage: null,
      providerFinishReason: null,
      ttftMs: null,
      rawText: '',
      streamedAnswer: '',
      estimatedInputTokens: 0,
    };
    const abort = linkAbort(input.signal, config.llmTimeoutMs);
    const elapsed = () => Math.round(clock() - startedAt);

    try {
      const history = await this.loadHistory(userId, documentId);
      const userMessage = await this.deps.messages.create({
        documentId,
        userId,
        role: 'user',
        content: question,
      });
      state.accepted = true;
      yield { type: 'accepted', userMessage: toMessageDto(userMessage) };

      yield { type: 'status', phase: 'retrieving' };
      const selection = await this.deps.selector.select({
        document,
        question,
        previousQuestion: history.previousQuestion,
        signal: abort.signal,
      });
      if (selection.sources.length === 0) throw new NotFoundError('Document content');
      state.strategy = selection.strategy;
      state.retrieval = this.toRetrieval(selection);

      const sources = this.toSourceRefs(selection);
      const promptSources = sources.map(({ id, page, text }): PromptSource => ({ id, page, text }));
      const built = template.build({
        question,
        history: history.turns,
        sources: promptSources as [PromptSource, ...PromptSource[]],
        scope: selection.strategy === 'full' ? 'full' : 'excerpts',
        nonce: (this.deps.newNonce ?? (() => randomBytes(12).toString('hex')))(),
      });
      state.estimatedInputTokens = estimateTokens(built.systemInstruction + built.userContent);
      state.injectionFlag ||=
        detectInjection(sources.map((source) => source.text).join('\n')).level === 'high';

      yield { type: 'status', phase: 'generating' };
      const extractor = new AnswerStreamExtractor();
      let finishReason: FinishReason = 'other';

      for await (const event of llm.generateStream({
        ...built,
        grounding: { question, sources: sources.map(({ id, text }) => ({ id, text })) },
        signal: abort.signal,
      })) {
        if (event.type === 'text') {
          state.rawText += event.text;
          state.ttftMs ??= elapsed();
          const delta = sanitizeText(extractor.push(event.text)).text;
          state.streamedAnswer = extractor.text;
          if (delta) yield { type: 'delta', text: delta };
        } else {
          state.usage = event.usage;
          state.providerFinishReason = event.providerFinishReason;
          finishReason = event.finishReason;
        }
      }

      const processed = processAnswer({
        raw: state.rawText,
        finishReason,
        sources,
        streamedAnswer: state.streamedAnswer,
      });
      const reply = await this.deps.messages.create({
        documentId,
        userId,
        role: 'assistant',
        content: processed.answer,
        answer: this.toAssistantAnswer(processed, sources, state, elapsed()),
        status: 'completed',
        aiRequestId: reservationId,
      });
      await this.settle(reservationId, FINISH_OUTCOMES[processed.status], state, elapsed());
      yield { type: 'final', message: toMessageDto(reply) };
    } catch (error) {
      if (abort.clientAborted()) return; // The `finally` below records this as a cancellation.

      // Our own deadline surfaces as an abort error the provider never classified; it is an outage to users.
      const appError = abort.timedOut() ? new AiUnavailableError(error) : toAppError(error);
      if (appError.status >= 500)
        logger.error({ err: toLoggableError(appError), code: appError.code }, 'ask failed');
      await this.settle(reservationId, 'error', state, elapsed());
      if (!state.accepted) throw appError; // Nothing streamed yet, so the HTTP layer can use its status.

      await this.deps.messages.create({
        documentId,
        userId,
        role: 'assistant',
        content: '',
        status: 'failed',
        errorCode: appError.code,
        aiRequestId: reservationId,
      });
      yield {
        type: 'error',
        problem: toProblemDetails(appError, {
          requestId: input.requestId,
          instance: input.instance,
        }),
      };
    } finally {
      abort.dispose();
      if (!state.settled) {
        // Reached when the consumer stopped early (Stop button, disconnect): keep what was written.
        if (state.accepted) {
          await this.deps.messages
            .create({
              documentId,
              userId,
              role: 'assistant',
              content: state.streamedAnswer,
              status: 'cancelled',
              aiRequestId: reservationId,
            })
            .catch((error: unknown) =>
              logger.error({ err: toLoggableError(error) }, 'could not store cancelled reply'),
            );
        }
        await this.settle(reservationId, 'cancelled', state, elapsed());
      }
    }
  }

  private estimateReservation(document: DocumentSummaryRecord, question: string): number {
    const { fullContextMaxTokens, ragTopK } = this.deps.config;
    const context =
      document.tokenEstimate <= fullContextMaxTokens
        ? document.tokenEstimate
        : ragTopK * RETRIEVED_CHUNK_TOKENS;
    return (
      context + estimateTokens(question) + SYSTEM_AND_HISTORY_RESERVE_TOKENS + OUTPUT_RESERVE_TOKENS
    );
  }

  private async loadHistory(
    userId: string,
    documentId: string,
  ): Promise<{ turns: HistoryTurn[]; previousQuestion: string | null }> {
    const recent = (await this.deps.messages.listByDocument(userId, documentId))
      .filter((message) => message.status === 'completed' && message.content.trim() !== '')
      .slice(-HISTORY_MESSAGES);
    const lastQuestion = [...recent].reverse().find((message) => message.role === 'user');
    return {
      turns: recent.map((message) => ({ role: message.role, content: message.content })),
      previousQuestion: lastQuestion?.content ?? null,
    };
  }

  private toSourceRefs(selection: ContextSelection): SourceRef[] {
    return selection.sources.map((source, index) => ({
      id: `S${index + 1}`,
      chunkId: source.chunkId,
      page: source.page,
      text: source.text,
    }));
  }

  private toRetrieval(selection: ContextSelection): RetrievalHit[] | null {
    if (selection.strategy === 'full') return null;
    return selection.sources.map((source) => ({
      chunkId: source.chunkId,
      score: source.score ?? 0,
    }));
  }

  private toAssistantAnswer(
    processed: ProcessedAnswer,
    sources: readonly SourceRef[],
    state: RunState,
    latencyMs: number,
  ): AssistantAnswer {
    const usage = state.usage;
    return {
      status: processed.status,
      answer: processed.answer,
      citations: processed.citations.map(({ sourceId, page, quote, verified }) => ({
        sourceId,
        page,
        quote,
        verified,
      })),
      followUpQuestions: [...processed.followUpQuestions],
      confidence: processed.confidence,
      warnings: [...processed.warnings],
      sources: sources.map(({ id, page, text }) => ({ id, page, text })),
      meta: {
        model: this.deps.llm.model,
        promptVersion: this.deps.config.promptVersion,
        inputTokens: usage?.inputTokens ?? state.estimatedInputTokens,
        // Reasoning tokens are billed as output, so the footnote counts them there.
        outputTokens: (usage?.outputTokens ?? 0) + (usage?.thinkingTokens ?? 0),
        latencyMs,
      },
    };
  }

  /** Closes the usage row: real figures when the provider reported them, estimates when it was cut short. */
  private async settle(
    reservationId: string,
    outcome: Exclude<AiOutcome, 'in_progress'>,
    state: RunState,
    latencyMs: number,
  ): Promise<void> {
    if (state.settled) return;
    state.settled = true;

    const usage: TokenUsage | null =
      state.usage ??
      (state.estimatedInputTokens > 0
        ? {
            inputTokens: state.estimatedInputTokens,
            outputTokens: estimateTokens(state.rawText),
            thinkingTokens: 0,
          }
        : null);
    try {
      await this.deps.aiRequests.finalize({
        id: reservationId,
        outcome,
        usage,
        costUsd: usage ? estimateCostUsd(this.deps.llm.model, usage) : null,
        latencyMs,
        ttftMs: state.ttftMs,
        finishReason: state.providerFinishReason,
        contextStrategy: state.strategy,
        retrieval: state.retrieval,
        injectionFlag: state.injectionFlag,
      });
    } catch (error) {
      this.deps.logger.error(
        { err: toLoggableError(error), reservationId },
        'could not settle AI request',
      );
    }
  }
}
