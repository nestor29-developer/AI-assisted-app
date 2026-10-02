import { and, eq, sql } from 'drizzle-orm';

import type { TokenUsage } from '@/server/ai/providers/types';
import type { Database } from '@/server/core/db/client';
import { aiRequests } from '@/server/core/db/schema';

export type AiOutcome = 'in_progress' | 'success' | 'error' | 'cancelled' | 'declined';
export type ContextStrategyName = 'full' | 'retrieval';
export interface RetrievalHit {
  readonly chunkId: string;
  readonly score: number;
}

export interface ReservationPolicy {
  readonly maxConcurrent: number;
  readonly dailyBudgetTokens: number;
  /** Rolling window the budget is measured over. */
  readonly windowSeconds: number;
  /** An in_progress row older than this belongs to a dead task and is ignored. */
  readonly staleAfterSeconds: number;
}

export interface ReserveRequest {
  readonly userId: string;
  readonly documentId: string | null;
  readonly provider: string;
  readonly model: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly appVersion: string;
  /** Prompt estimate plus the output cap; released and replaced by real usage on finalize. */
  readonly estimatedTokens: number;
  readonly policy: ReservationPolicy;
}

export type ReserveResult =
  | { readonly ok: true; readonly id: string }
  | {
      readonly ok: false;
      readonly reason: 'concurrency' | 'quota';
      readonly retryAfterSeconds: number;
    };

export interface FinalizeRequest {
  readonly id: string;
  readonly outcome: Exclude<AiOutcome, 'in_progress'>;
  readonly usage: TokenUsage | null;
  readonly costUsd: number | null;
  readonly latencyMs: number;
  readonly ttftMs: number | null;
  readonly finishReason: string | null;
  readonly contextStrategy: ContextStrategyName | null;
  readonly retrieval: readonly RetrievalHit[] | null;
  readonly injectionFlag: boolean;
}

export interface EmbeddingRecordRequest {
  readonly userId: string;
  readonly documentId: string | null;
  readonly provider: string;
  readonly model: string;
  readonly appVersion: string;
  readonly inputTokens: number;
  readonly costUsd: number | null;
  readonly latencyMs: number;
  readonly injectionFlag: boolean;
}

export interface AiRequestRecord {
  readonly id: string;
  readonly userId: string;
  readonly documentId: string | null;
  readonly operation: 'chat' | 'embed_document' | 'embed_query';
  readonly outcome: AiOutcome;
  readonly reservedTokens: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly thinkingTokens: number | null;
  readonly estimatedCostUsd: number | null;
  readonly finishReason: string | null;
  readonly contextStrategy: ContextStrategyName | null;
  readonly retrieval: readonly RetrievalHit[] | null;
  readonly injectionFlag: boolean;
}

/** Usage ledger, quota and concurrency gate. Rows hold metadata only, never prompt or answer text. */
export interface AiRequestRepository {
  /** Atomic per user: checks the concurrency cap and the rolling budget, then records the reservation. */
  reserve(request: ReserveRequest): Promise<ReserveResult>;
  /** Idempotent: a row that is already finished is left alone. */
  finalize(request: FinalizeRequest): Promise<void>;
  recordEmbedding(request: EmbeddingRecordRequest): Promise<string>;
  findById(id: string): Promise<AiRequestRecord | null>;
  /** Marks reservations left behind by dead tasks as errors; returns how many. */
  markStale(staleAfterSeconds: number): Promise<number>;
}

const CONCURRENCY_RETRY_SECONDS = 5;
const MIN_QUOTA_RETRY_SECONDS = 60;

const interval = (seconds: number) => sql`make_interval(secs => ${seconds}::double precision)`;

export class DrizzleAiRequestRepository implements AiRequestRepository {
  constructor(private readonly db: Database) {}

  async reserve(request: ReserveRequest): Promise<ReserveResult> {
    const { policy } = request;

    return this.db.transaction(async (tx) => {
      // Serializes reservations per user; released at commit, so it is never held during a model call.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${request.userId}, 0))`);

      const live = and(
        eq(aiRequests.outcome, 'in_progress'),
        sql`${aiRequests.createdAt} > now() - ${interval(policy.staleAfterSeconds)}`,
      );
      const [usage] = await tx
        .select({
          inFlight: sql<number>`count(*) filter (where ${live})`.mapWith(Number),
          used: sql<number>`coalesce(sum(
              case when ${aiRequests.outcome} = 'in_progress'
                   then (case when ${live} then ${aiRequests.reservedTokens} else 0 end)
                   else coalesce(${aiRequests.inputTokens}, 0) + coalesce(${aiRequests.outputTokens}, 0)
                        + coalesce(${aiRequests.thinkingTokens}, 0)
              end), 0)`.mapWith(Number),
          secondsUntilOldestExpires: sql<
            number | null
          >`ceil(extract(epoch from (min(${aiRequests.createdAt}) + ${interval(policy.windowSeconds)} - now())))`,
        })
        .from(aiRequests)
        .where(
          and(
            eq(aiRequests.userId, request.userId),
            eq(aiRequests.operation, 'chat'),
            sql`${aiRequests.createdAt} > now() - ${interval(policy.windowSeconds)}`,
          ),
        );

      if ((usage?.inFlight ?? 0) >= policy.maxConcurrent) {
        return { ok: false, reason: 'concurrency', retryAfterSeconds: CONCURRENCY_RETRY_SECONDS };
      }
      if ((usage?.used ?? 0) + request.estimatedTokens > policy.dailyBudgetTokens) {
        const wait = Number(usage?.secondsUntilOldestExpires ?? MIN_QUOTA_RETRY_SECONDS);
        return {
          ok: false,
          reason: 'quota',
          retryAfterSeconds: Math.max(MIN_QUOTA_RETRY_SECONDS, wait),
        };
      }

      const [row] = await tx
        .insert(aiRequests)
        .values({
          userId: request.userId,
          documentId: request.documentId,
          operation: 'chat',
          provider: request.provider,
          model: request.model,
          promptId: request.promptId,
          promptVersion: request.promptVersion,
          appVersion: request.appVersion,
          reservedTokens: request.estimatedTokens,
          outcome: 'in_progress',
        })
        .returning({ id: aiRequests.id });
      if (!row) throw new Error('Insert into ai_requests returned no row');
      return { ok: true, id: row.id };
    });
  }

  async finalize(request: FinalizeRequest): Promise<void> {
    await this.db
      .update(aiRequests)
      .set({
        outcome: request.outcome,
        inputTokens: request.usage?.inputTokens ?? null,
        outputTokens: request.usage?.outputTokens ?? null,
        thinkingTokens: request.usage?.thinkingTokens ?? null,
        estimatedCostUsd: request.costUsd,
        latencyMs: request.latencyMs,
        ttftMs: request.ttftMs,
        finishReason: request.finishReason,
        contextStrategy: request.contextStrategy,
        retrieval: request.retrieval ? [...request.retrieval] : null,
        injectionFlag: request.injectionFlag,
      })
      .where(and(eq(aiRequests.id, request.id), eq(aiRequests.outcome, 'in_progress')));
  }

  async recordEmbedding(request: EmbeddingRecordRequest): Promise<string> {
    const [row] = await this.db
      .insert(aiRequests)
      .values({
        userId: request.userId,
        documentId: request.documentId,
        operation: 'embed_document',
        provider: request.provider,
        model: request.model,
        appVersion: request.appVersion,
        inputTokens: request.inputTokens,
        estimatedCostUsd: request.costUsd,
        latencyMs: request.latencyMs,
        injectionFlag: request.injectionFlag,
        outcome: 'success',
      })
      .returning({ id: aiRequests.id });
    if (!row) throw new Error('Insert into ai_requests returned no row');
    return row.id;
  }

  async findById(id: string): Promise<AiRequestRecord | null> {
    const [row] = await this.db.select().from(aiRequests).where(eq(aiRequests.id, id)).limit(1);
    return row ?? null;
  }

  async markStale(staleAfterSeconds: number): Promise<number> {
    const updated = await this.db
      .update(aiRequests)
      .set({ outcome: 'error', finishReason: 'stale' })
      .where(
        and(
          eq(aiRequests.outcome, 'in_progress'),
          sql`${aiRequests.createdAt} < now() - ${interval(staleAfterSeconds)}`,
        ),
      )
      .returning({ id: aiRequests.id });
    return updated.length;
  }
}
