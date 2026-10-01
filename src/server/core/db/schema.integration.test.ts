import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EMBEDDING_DIMENSIONS } from '@/server/core/constants';
import { aiRequests, documentChunks, users } from '@/server/core/db/schema';
import { connectTestDatabase } from '@/test/helpers/database';
import { seedDocument, seedUser } from '@/test/helpers/seed';

import { hasPgErrorCode } from './errors';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

type TestDatabase = Awaited<ReturnType<typeof connectTestDatabase>>;

describe('schema constraints (real Postgres)', () => {
  let database: TestDatabase;
  let userId: string;
  let documentId: string;

  const baseRequest = () => ({
    userId,
    operation: 'chat' as const,
    provider: 'mock',
    model: 'mock',
    appVersion: 'test',
  });

  beforeAll(async () => {
    database = await connectTestDatabase();
    userId = await seedUser(database.db);
    documentId = await seedDocument(database.db, userId);
  });

  afterAll(async () => {
    await database.db.delete(users).where(eq(users.id, userId));
    await database.close();
  });

  it.each([
    ['input_tokens', { inputTokens: -1 }],
    ['output_tokens', { outputTokens: -5 }],
    ['thinking_tokens', { thinkingTokens: -1 }],
    ['reserved_tokens', { reservedTokens: -100 }],
  ])('rejects a negative %s (it would shrink the daily quota SUM)', async (_name, overrides) => {
    const attempt = database.db.insert(aiRequests).values({ ...baseRequest(), ...overrides });

    const error = await attempt.catch((e: unknown) => e);

    expect(hasPgErrorCode(error, CHECK_VIOLATION)).toBe(true);
  });

  it('accepts unset token counts, as for a request that is still in progress', async () => {
    const [row] = await database.db
      .insert(aiRequests)
      .values({ ...baseRequest(), reservedTokens: 4_096 })
      .returning({ outcome: aiRequests.outcome, inputTokens: aiRequests.inputTokens });

    expect(row).toEqual({ outcome: 'in_progress', inputTokens: null });
  });

  it('rejects an unknown context strategy', async () => {
    const attempt = database.db.insert(aiRequests).values({
      ...baseRequest(),
      contextStrategy: 'everything' as unknown as 'full',
    });

    expect(hasPgErrorCode(await attempt.catch((e: unknown) => e), CHECK_VIOLATION)).toBe(true);
  });

  it('refuses two chunks with the same ordinal in one document', async () => {
    const embedding = new Array<number>(EMBEDDING_DIMENSIONS).fill(0.1);
    const chunk = { documentId, userId, ordinal: 0, content: 'a', embedding };
    await database.db.insert(documentChunks).values(chunk);

    const duplicate = await database.db
      .insert(documentChunks)
      .values({ ...chunk, content: 'b' })
      .catch((e: unknown) => e);

    expect(hasPgErrorCode(duplicate, UNIQUE_VIOLATION)).toBe(true);
  });

  it('has the indexes that keep purges and cascades off sequential scans', async () => {
    const { rows } = await database.db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where schemaname = 'public'`,
    );
    const names = rows.map((row) => row.indexname);

    expect(names).toEqual(
      expect.arrayContaining([
        'ai_requests_document_id_idx',
        'ai_requests_user_id_created_at_idx',
        'messages_ai_request_id_idx',
        'messages_document_id_created_at_idx',
        'documents_expires_at_idx',
        'rate_limit_windows_window_start_key_pk',
      ]),
    );
  });
});
