import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '@/server/core/db/client';

import type { AiRequestRepository } from './ai-request.repository';
import { RetentionService, type RetentionPolicy } from './retention.service';

const policy: RetentionPolicy = {
  aiRequestRetentionDays: 90,
  staleAfterSeconds: 120,
  batchSize: 2,
};
const dialect = new PgDialect();

type Table = 'documents' | 'ai_requests' | 'rate_limit_windows';

/** A database whose deletes answer with the rows each table "had", given how many calls came before. */
function database(answer: (table: Table, call: number) => number | Error) {
  const calls: Table[] = [];
  const counts: Record<Table, number> = { documents: 0, ai_requests: 0, rate_limit_windows: 0 };
  const execute = vi.fn(async (statement: SQL) => {
    const text = dialect.sqlToQuery(statement).sql;
    const table = (['documents', 'ai_requests', 'rate_limit_windows'] as const).find((name) =>
      text.includes(`delete from ${name}`),
    );
    if (!table) throw new Error(`unexpected statement: ${text}`);
    calls.push(table);
    const outcome = answer(table, counts[table]++);
    if (outcome instanceof Error) throw outcome;
    return { rowCount: outcome };
  });
  return { db: { execute } as unknown as Database, calls };
}

const requests = (closed = 0) =>
  ({ markStale: vi.fn(async () => closed) }) as unknown as AiRequestRepository;

describe('RetentionService', () => {
  it('reports what it did, with nothing truncated or failed', async () => {
    const { db } = database((table, call) => (table === 'documents' && call === 0 ? 1 : 0));

    const result = await new RetentionService(db, requests(3), policy).run();

    expect(result).toEqual({
      staleRequestsClosed: 3,
      documentsDeleted: 1,
      aiRequestsDeleted: 0,
      rateLimitWindowsDeleted: 0,
      truncated: [],
      failed: [],
    });
  });

  it('carries on with the other steps when one fails, and says which one failed and why', async () => {
    const timeout = Object.assign(new Error('canceling statement due to statement timeout'), {
      code: '57014',
    });
    const { db, calls } = database((table) =>
      table === 'documents'
        ? new Error('Failed query: delete from documents\nparams: 500', { cause: timeout })
        : 1,
    );

    const result = await new RetentionService(db, requests(), policy).run();

    expect(result.failed).toEqual([
      { step: 'documents', message: 'canceling statement due to statement timeout', code: '57014' },
    ]);
    expect(JSON.stringify(result.failed)).not.toContain('params');
    expect(calls).toContain('ai_requests');
    expect(calls).toContain('rate_limit_windows');
    expect(result.aiRequestsDeleted).toBe(1);
    expect(result.rateLimitWindowsDeleted).toBe(1);
  });

  it('reports a failure in the first step too, and still runs the rest', async () => {
    const { db, calls } = database(() => 0);
    const stale = { markStale: vi.fn(async () => Promise.reject(new Error('no connection'))) };

    const result = await new RetentionService(
      db,
      stale as unknown as AiRequestRepository,
      policy,
    ).run();

    expect(result.failed).toEqual([{ step: 'stale_requests', message: 'no connection' }]);
    expect(calls).toEqual(['documents', 'ai_requests', 'rate_limit_windows']);
  });

  it('keeps the count of a step that fails part way through', async () => {
    const { db } = database((table, call) => {
      if (table !== 'documents') return 0;
      return call < 2 ? 2 : new Error('connection lost');
    });

    const result = await new RetentionService(db, requests(), policy).run();

    expect(result.documentsDeleted).toBe(4);
    expect(result.failed).toEqual([{ step: 'documents', message: 'connection lost' }]);
  });

  it('works through a backlog of many batches, and stops when a batch comes back short', async () => {
    const { db } = database((table, call) => (table === 'documents' ? [2, 2, 2, 1][call]! : 0));

    const result = await new RetentionService(db, requests(), policy).run();

    expect(result.documentsDeleted).toBe(7);
    expect(result.truncated).toEqual([]);
  });

  it('reports a step that never runs dry as truncated, instead of looping for ever', async () => {
    const { db } = database((table) => (table === 'documents' ? policy.batchSize : 0));

    const result = await new RetentionService(db, requests(), policy).run();

    expect(result.truncated).toEqual(['documents']);
    expect(result.documentsDeleted).toBe(10_000 * policy.batchSize);
    expect(result.failed).toEqual([]);
  });

  it('rests between full batches, and not after the last one', async () => {
    const pause = vi.fn(async () => undefined);
    const { db } = database((table, call) => (table === 'documents' ? [2, 2, 1][call]! : 0));

    await new RetentionService(
      db,
      requests(),
      { ...policy, pauseBetweenBatchesMs: 75 },
      pause,
    ).run();

    expect(pause).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledWith(75);
  });

  it('does not rest when no pause is set', async () => {
    const pause = vi.fn(async () => undefined);
    const { db } = database((table, call) => (table === 'documents' ? [2, 2, 1][call]! : 0));

    await new RetentionService(db, requests(), policy, pause).run();

    expect(pause).not.toHaveBeenCalled();
  });
});
