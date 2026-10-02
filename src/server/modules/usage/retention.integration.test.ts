import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EMBEDDING_DIMENSIONS } from '@/server/core/constants';
import {
  aiRequests,
  documentChunks,
  documents,
  messages,
  rateLimitWindows,
  users,
} from '@/server/core/db/schema';
import { connectTestDatabase } from '@/test/helpers/database';
import { seedUser } from '@/test/helpers/seed';

import { DrizzleAiRequestRepository } from './ai-request.repository';
import { RetentionService, type RetentionPolicy } from './retention.service';

type TestDatabase = Awaited<ReturnType<typeof connectTestDatabase>>;

const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
const policy: RetentionPolicy = {
  aiRequestRetentionDays: 90,
  staleAfterSeconds: 120,
  batchSize: 2,
};

describe('RetentionService (real Postgres)', () => {
  let database: TestDatabase;
  let service: RetentionService;
  const userIds: string[] = [];
  const windowKeys: string[] = [];

  beforeAll(async () => {
    database = await connectTestDatabase();
    service = new RetentionService(
      database.db,
      new DrizzleAiRequestRepository(database.db),
      policy,
    );
  });

  afterAll(async () => {
    await database.db.delete(rateLimitWindows).where(inArray(rateLimitWindows.key, windowKeys));
    if (userIds.length > 0) await database.db.delete(users).where(inArray(users.id, userIds));
    await database.close();
  });

  async function newUser() {
    const id = await seedUser(database.db);
    userIds.push(id);
    return id;
  }

  async function newDocument(userId: string, expiresInDays: number) {
    const [document] = await database.db
      .insert(documents)
      .values({
        userId,
        title: 'Doc',
        sourceType: 'text',
        mimeType: 'text/plain',
        sizeBytes: 10,
        content: 'content',
        tokenEstimate: 3,
        chunkCount: 1,
        embeddingModel: 'test',
        chunkerVersion: 'v1',
        expiresAt: new Date(Date.now() + expiresInDays * DAY_MS),
      })
      .returning({ id: documents.id });
    await database.db.insert(documentChunks).values({
      documentId: document!.id,
      userId,
      ordinal: 0,
      content: 'chunk',
      embedding: new Array<number>(EMBEDDING_DIMENSIONS).fill(0.1),
    });
    return document!.id;
  }

  async function newRequest(
    userId: string,
    options: {
      ageDays?: number;
      ageMinutes?: number;
      outcome?: 'in_progress' | 'success';
      documentId?: string;
    } = {},
  ) {
    const age = options.ageMinutes
      ? new Date(Date.now() - options.ageMinutes * 60_000)
      : daysAgo(options.ageDays ?? 0);
    const [row] = await database.db
      .insert(aiRequests)
      .values({
        userId,
        documentId: options.documentId ?? null,
        operation: 'chat',
        provider: 'mock',
        model: 'mock',
        appVersion: 'test',
        outcome: options.outcome ?? 'success',
        createdAt: age,
      })
      .returning({ id: aiRequests.id });
    return row!.id;
  }

  const exists = async (table: typeof documents | typeof aiRequests, id: string) =>
    (await database.db.select({ id: table.id }).from(table).where(eq(table.id, id))).length === 1;

  it('removes expired documents with their chunks and messages, and keeps the others', async () => {
    const userId = await newUser();
    const expired = await newDocument(userId, -1);
    const alive = await newDocument(userId, 10);
    await database.db.insert(messages).values([
      { documentId: expired, userId, role: 'user', content: 'gone' },
      { documentId: alive, userId, role: 'user', content: 'stays' },
    ]);

    const result = await service.run();

    expect(result.documentsDeleted).toBeGreaterThanOrEqual(1);
    expect(await exists(documents, expired)).toBe(false);
    expect(await exists(documents, alive)).toBe(true);
    const chunks = await database.db
      .select()
      .from(documentChunks)
      .where(inArray(documentChunks.documentId, [expired, alive]));
    expect(chunks.map((chunk) => chunk.documentId)).toEqual([alive]);
    const kept = await database.db
      .select()
      .from(messages)
      .where(inArray(messages.documentId, [expired, alive]));
    expect(kept.map((message) => message.content)).toEqual(['stays']);
  });

  it('keeps the audit row of a deleted document, but forgets which document it was', async () => {
    const userId = await newUser();
    const expired = await newDocument(userId, -1);
    const requestId = await newRequest(userId, { documentId: expired });

    await service.run();

    const [row] = await database.db.select().from(aiRequests).where(eq(aiRequests.id, requestId));
    expect(row?.documentId).toBeNull();
  });

  it('deletes audit rows past retention and never one that is still recent', async () => {
    const userId = await newUser();
    const old = await newRequest(userId, { ageDays: 100 });
    const recent = await newRequest(userId, { ageDays: 10 });
    const documentId = await newDocument(userId, 10);
    const [reply] = await database.db
      .insert(messages)
      .values({ documentId, userId, role: 'assistant', content: 'a', aiRequestId: old })
      .returning({ id: messages.id });

    const result = await service.run();

    expect(result.aiRequestsDeleted).toBeGreaterThanOrEqual(1);
    expect(await exists(aiRequests, old)).toBe(false);
    expect(await exists(aiRequests, recent)).toBe(true);
    const [kept] = await database.db.select().from(messages).where(eq(messages.id, reply!.id));
    expect(kept?.aiRequestId).toBeNull();
  });

  it('closes abandoned in-progress requests as errors, leaves fresh ones alone, and then lets old ones go', async () => {
    const userId = await newUser();
    const abandoned = await newRequest(userId, { ageMinutes: 30, outcome: 'in_progress' });
    const running = await newRequest(userId, { ageMinutes: 0, outcome: 'in_progress' });
    const ancientAbandoned = await newRequest(userId, { ageDays: 120, outcome: 'in_progress' });

    const result = await service.run();

    expect(result.staleRequestsClosed).toBeGreaterThanOrEqual(2);
    const [closed] = await database.db
      .select()
      .from(aiRequests)
      .where(eq(aiRequests.id, abandoned));
    expect(closed).toMatchObject({ outcome: 'error', finishReason: 'stale' });
    const [live] = await database.db.select().from(aiRequests).where(eq(aiRequests.id, running));
    expect(live?.outcome).toBe('in_progress');
    expect(await exists(aiRequests, ancientAbandoned)).toBe(false);
  });

  it('works through a backlog bigger than one batch', async () => {
    const userId = await newUser();
    const expired = await Promise.all([1, 2, 3, 4, 5].map(() => newDocument(userId, -1)));

    const result = await service.run();

    expect(result.documentsDeleted).toBeGreaterThanOrEqual(5);
    const left = await database.db
      .select({ id: documents.id })
      .from(documents)
      .where(inArray(documents.id, expired));
    expect(left).toEqual([]);
  });

  it('is safe to run twice at once: every row goes exactly once and nothing fails', async () => {
    const userId = await newUser();
    const expired = await Promise.all([1, 2, 3, 4, 5, 6].map(() => newDocument(userId, -1)));

    const [first, second] = await Promise.all([service.run(), service.run()]);

    expect(first.documentsDeleted + second.documentsDeleted).toBeGreaterThanOrEqual(6);
    const left = await database.db
      .select({ id: documents.id })
      .from(documents)
      .where(inArray(documents.id, expired));
    expect(left).toEqual([]);
  });

  it('deletes spent rate-limit counters and keeps the current ones', async () => {
    const stale = `retention:${randomUUID()}`;
    const current = `retention:${randomUUID()}`;
    windowKeys.push(stale, current);
    await database.db.insert(rateLimitWindows).values([
      { key: stale, windowStart: daysAgo(3), count: 4 },
      { key: current, windowStart: new Date(), count: 1 },
    ]);

    const result = await service.run();

    expect(result.rateLimitWindowsDeleted).toBeGreaterThanOrEqual(1);
    const left = await database.db
      .select()
      .from(rateLimitWindows)
      .where(inArray(rateLimitWindows.key, [stale, current]));
    expect(left.map((row) => row.key)).toEqual([current]);
  });

  it('finds nothing to do the second time', async () => {
    await service.run();

    const again = await service.run();

    expect(again).toEqual({
      staleRequestsClosed: 0,
      documentsDeleted: 0,
      aiRequestsDeleted: 0,
      rateLimitWindowsDeleted: 0,
    });
  });
});
