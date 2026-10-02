import type {
  AiRequestRecord,
  AiRequestRepository,
  EmbeddingRecordRequest,
  FinalizeRequest,
  ReserveRequest,
  ReserveResult,
} from '@/server/modules/usage/ai-request.repository';

type Row = { -readonly [K in keyof AiRequestRecord]: AiRequestRecord[K] } & { createdAt: Date };

/** Same rules as the SQL implementation, with a clock the tests can move. */
export class InMemoryAiRequestRepository implements AiRequestRepository {
  private readonly rows = new Map<string, Row>();
  private offsetMs = 0;

  advance(ms: number): void {
    this.offsetMs += ms;
  }

  private now(): number {
    return Date.now() + this.offsetMs;
  }

  async reserve(request: ReserveRequest): Promise<ReserveResult> {
    const { policy } = request;
    const now = this.now();
    const inWindow = [...this.rows.values()].filter(
      (row) =>
        row.userId === request.userId &&
        row.operation === 'chat' &&
        row.createdAt.getTime() > now - policy.windowSeconds * 1000,
    );
    const isLive = (row: Row) =>
      row.outcome === 'in_progress' &&
      row.createdAt.getTime() > now - policy.staleAfterSeconds * 1000;

    const inFlight = inWindow.filter(isLive).length;
    const used = inWindow.reduce((sum, row) => {
      if (row.outcome === 'in_progress') return sum + (isLive(row) ? row.reservedTokens : 0);
      return sum + (row.inputTokens ?? 0) + (row.outputTokens ?? 0) + (row.thinkingTokens ?? 0);
    }, 0);

    if (inFlight >= policy.maxConcurrent)
      return { ok: false, reason: 'concurrency', retryAfterSeconds: 5 };
    if (used + request.estimatedTokens > policy.dailyBudgetTokens) {
      const oldest = Math.min(...inWindow.map((row) => row.createdAt.getTime()));
      const wait =
        inWindow.length === 0 ? 60 : Math.ceil((oldest + policy.windowSeconds * 1000 - now) / 1000);
      return { ok: false, reason: 'quota', retryAfterSeconds: Math.max(60, wait) };
    }

    const id = crypto.randomUUID();
    this.rows.set(id, {
      id,
      userId: request.userId,
      documentId: request.documentId,
      operation: 'chat',
      outcome: 'in_progress',
      reservedTokens: request.estimatedTokens,
      inputTokens: null,
      outputTokens: null,
      thinkingTokens: null,
      estimatedCostUsd: null,
      finishReason: null,
      contextStrategy: null,
      retrieval: null,
      injectionFlag: false,
      createdAt: new Date(now),
    });
    return { ok: true, id };
  }

  async finalize(request: FinalizeRequest): Promise<void> {
    const row = this.rows.get(request.id);
    if (!row || row.outcome !== 'in_progress') return;
    Object.assign(row, {
      outcome: request.outcome,
      inputTokens: request.usage?.inputTokens ?? null,
      outputTokens: request.usage?.outputTokens ?? null,
      thinkingTokens: request.usage?.thinkingTokens ?? null,
      estimatedCostUsd: request.costUsd,
      finishReason: request.finishReason,
      contextStrategy: request.contextStrategy,
      retrieval: request.retrieval,
      injectionFlag: request.injectionFlag,
    });
  }

  async recordEmbedding(request: EmbeddingRecordRequest): Promise<string> {
    const id = crypto.randomUUID();
    this.rows.set(id, {
      id,
      userId: request.userId,
      documentId: request.documentId,
      operation: 'embed_document',
      outcome: 'success',
      reservedTokens: 0,
      inputTokens: request.inputTokens,
      outputTokens: null,
      thinkingTokens: null,
      estimatedCostUsd: request.costUsd,
      finishReason: null,
      contextStrategy: null,
      retrieval: null,
      injectionFlag: request.injectionFlag,
      createdAt: new Date(this.now()),
    });
    return id;
  }

  async findById(id: string): Promise<AiRequestRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async markStale(staleAfterSeconds: number): Promise<number> {
    let count = 0;
    for (const row of this.rows.values()) {
      if (
        row.outcome === 'in_progress' &&
        row.createdAt.getTime() < this.now() - staleAfterSeconds * 1000
      ) {
        row.outcome = 'error';
        row.finishReason = 'stale';
        count += 1;
      }
    }
    return count;
  }
}
