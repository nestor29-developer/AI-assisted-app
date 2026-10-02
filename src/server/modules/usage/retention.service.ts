import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@/server/core/db/client';

import type { AiRequestRepository } from './ai-request.repository';

export interface RetentionPolicy {
  readonly aiRequestRetentionDays: number;
  /** An in-progress request older than this belongs to a task that died, and is closed as an error. */
  readonly staleAfterSeconds: number;
  /** Rows per statement: small enough that no delete holds locks for long. */
  readonly batchSize: number;
}

export interface PurgeResult {
  readonly staleRequestsClosed: number;
  readonly documentsDeleted: number;
  readonly aiRequestsDeleted: number;
  readonly rateLimitWindowsDeleted: number;
}

/** Longer than any rate-limit window we use, so nothing still counting is ever removed. */
const RATE_LIMIT_WINDOW_RETENTION_HOURS = 24;
/** A runaway guard: at 500 rows a batch this is five million rows, far beyond a daily purge. */
const MAX_BATCHES = 10_000;

/** Enforces the retention promises: expired documents, old audit rows and spent rate-limit counters. */
export class RetentionService {
  constructor(
    private readonly db: Database,
    private readonly aiRequests: AiRequestRepository,
    private readonly policy: RetentionPolicy,
  ) {}

  async run(): Promise<PurgeResult> {
    const { batchSize, aiRequestRetentionDays, staleAfterSeconds } = this.policy;
    // First, so a request abandoned long ago is closed rather than kept as in progress forever.
    const staleRequestsClosed = await this.aiRequests.markStale(staleAfterSeconds);

    // Deleting a document cascades to its chunks and messages; audit rows keep a null document.
    const documentsDeleted = await this.deleteInBatches(sql`
      delete from documents using (
        select id from documents where expires_at < now()
        order by expires_at limit ${batchSize} for update skip locked
      ) doomed where documents.id = doomed.id`);

    // Messages that point at a deleted audit row simply lose the pointer.
    const aiRequestsDeleted = await this.deleteInBatches(sql`
      delete from ai_requests using (
        select id from ai_requests
        where outcome <> 'in_progress' and created_at < now() - make_interval(days => ${aiRequestRetentionDays}::int)
        limit ${batchSize} for update skip locked
      ) doomed where ai_requests.id = doomed.id`);

    const rateLimitWindowsDeleted = await this.deleteInBatches(sql`
      delete from rate_limit_windows where ctid in (
        select ctid from rate_limit_windows
        where window_start < now() - make_interval(hours => ${RATE_LIMIT_WINDOW_RETENTION_HOURS}::int)
        limit ${batchSize})`);

    return { staleRequestsClosed, documentsDeleted, aiRequestsDeleted, rateLimitWindowsDeleted };
  }

  private async deleteInBatches(statement: SQL): Promise<number> {
    let total = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const deleted = (await this.db.execute(statement)).rowCount ?? 0;
      total += deleted;
      if (deleted < this.policy.batchSize) break;
    }
    return total;
  }
}
