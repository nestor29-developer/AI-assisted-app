import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@/server/core/db/client';
import { toLoggableError } from '@/server/core/errors';

import type { AiRequestRepository } from './ai-request.repository';

export interface RetentionPolicy {
  readonly aiRequestRetentionDays: number;
  /** An in-progress request older than this belongs to a task that died, and is closed as an error. */
  readonly staleAfterSeconds: number;
  /** Rows per statement: each delete holds locks only on its own batch, so nothing waits on it long. */
  readonly batchSize: number;
  /** Rest between full batches, so a big backlog does not crowd out the app's own queries. */
  readonly pauseBetweenBatchesMs?: number;
}

export type PurgeStep = 'stale_requests' | 'documents' | 'ai_requests' | 'rate_limit_windows';

export interface PurgeResult {
  readonly staleRequestsClosed: number;
  readonly documentsDeleted: number;
  readonly aiRequestsDeleted: number;
  readonly rateLimitWindowsDeleted: number;
  /** Steps that stopped at the batch limit: rows are left over, and the next run carries on. */
  readonly truncated: readonly PurgeStep[];
  /** Steps that failed, by their root cause. The others still ran, and a failed step reports its progress. */
  readonly failed: readonly {
    readonly step: PurgeStep;
    readonly message: string;
    readonly code?: string;
  }[];
}

interface Progress {
  rows: number;
  truncated: boolean;
}

/** Longer than any rate-limit window we use, so nothing still counting is ever removed. */
const RATE_LIMIT_WINDOW_RETENTION_HOURS = 24;
/** A runaway guard: a step that needs more batches than this reports itself truncated. */
const MAX_BATCHES = 10_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Enforces the retention promises: expired documents, old audit rows and spent rate-limit counters. */
export class RetentionService {
  constructor(
    private readonly db: Database,
    private readonly aiRequests: AiRequestRepository,
    private readonly policy: RetentionPolicy,
    private readonly pause: (ms: number) => Promise<void> = sleep,
  ) {}

  async run(): Promise<PurgeResult> {
    const { batchSize, aiRequestRetentionDays, staleAfterSeconds } = this.policy;
    const rows: Record<PurgeStep, number> = {
      stale_requests: 0,
      documents: 0,
      ai_requests: 0,
      rate_limit_windows: 0,
    };
    const truncated: PurgeStep[] = [];
    const failed: PurgeResult['failed'][number][] = [];

    // One step failing (a timeout on a big table, say) must not stop the others from running.
    const attempt = async (step: PurgeStep, work: (progress: Progress) => Promise<void>) => {
      const progress: Progress = { rows: 0, truncated: false };
      try {
        await work(progress);
      } catch (error) {
        const { message, code } = toLoggableError(error);
        failed.push({ step, message, ...(code === undefined ? {} : { code }) });
      }
      rows[step] = progress.rows;
      if (progress.truncated) truncated.push(step);
    };

    // First, so a request abandoned long ago is closed rather than kept as in progress forever.
    await attempt('stale_requests', async (progress) => {
      progress.rows = await this.aiRequests.markStale(staleAfterSeconds);
    });

    // Deleting a document cascades to its chunks and messages; audit rows keep a null document.
    // Rows that another run has locked are skipped, and left to that run.
    await attempt('documents', (progress) =>
      this.deleteInBatches(
        sql`
      delete from documents using (
        select id from documents where expires_at < now()
        order by expires_at limit ${batchSize} for update skip locked
      ) doomed where documents.id = doomed.id`,
        progress,
      ),
    );

    // Messages that point at a deleted audit row simply lose the pointer.
    await attempt('ai_requests', (progress) =>
      this.deleteInBatches(
        sql`
      delete from ai_requests using (
        select id from ai_requests
        where outcome <> 'in_progress' and created_at < now() - make_interval(days => ${aiRequestRetentionDays}::int)
        limit ${batchSize} for update skip locked
      ) doomed where ai_requests.id = doomed.id`,
        progress,
      ),
    );

    await attempt('rate_limit_windows', (progress) =>
      this.deleteInBatches(
        sql`
      delete from rate_limit_windows where ctid in (
        select ctid from rate_limit_windows
        where window_start < now() - make_interval(hours => ${RATE_LIMIT_WINDOW_RETENTION_HOURS}::int)
        limit ${batchSize})`,
        progress,
      ),
    );

    return {
      staleRequestsClosed: rows.stale_requests,
      documentsDeleted: rows.documents,
      aiRequestsDeleted: rows.ai_requests,
      rateLimitWindowsDeleted: rows.rate_limit_windows,
      truncated,
      failed,
    };
  }

  private async deleteInBatches(statement: SQL, progress: Progress): Promise<void> {
    const { batchSize, pauseBetweenBatchesMs = 0 } = this.policy;
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const deleted = (await this.db.execute(statement)).rowCount ?? 0;
      progress.rows += deleted;
      if (deleted < batchSize) return;
      if (pauseBetweenBatchesMs > 0) await this.pause(pauseBetweenBatchesMs);
    }
    progress.truncated = true;
  }
}
