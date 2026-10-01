import { randomUUID } from 'node:crypto';

import { and, cosineDistance, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EMBEDDING_DIMENSIONS } from '@/server/core/constants';
import { documentChunks, documents, users } from '@/server/core/db/schema';
import { connectTestDatabase } from '@/test/helpers/database';

type TestDatabase = Awaited<ReturnType<typeof connectTestDatabase>>;

/** A vector that points mostly along `axis`, optionally leaning toward another axis. */
function vector(axis: number, lean?: { axis: number; weight: number }): number[] {
  const values = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  values[axis] = 1;
  if (lean) values[lean.axis] = lean.weight;
  return values;
}

describe('pgvector schema (real Postgres)', () => {
  let database: TestDatabase;
  const userIds: string[] = [];

  async function seedDocument(chunks: { content: string; embedding: number[] }[]) {
    const { db } = database;
    const [user] = await db
      .insert(users)
      .values({ email: `vec-${randomUUID()}@example.com`, passwordHash: 'x' })
      .returning();
    const [document] = await db
      .insert(documents)
      .values({
        userId: user!.id,
        title: 'Doc',
        sourceType: 'text',
        mimeType: 'text/plain',
        sizeBytes: 10,
        content: 'content',
        tokenEstimate: 3,
        chunkCount: chunks.length,
        embeddingModel: 'test',
        chunkerVersion: 'v1',
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning();
    await db.insert(documentChunks).values(
      chunks.map((chunk, ordinal) => ({
        documentId: document!.id,
        userId: user!.id,
        ordinal,
        ...chunk,
      })),
    );
    userIds.push(user!.id);
    return { userId: user!.id, documentId: document!.id };
  }

  beforeAll(async () => {
    database = await connectTestDatabase();
  });

  afterAll(async () => {
    await database.db.delete(users).where(inArray(users.id, userIds));
    await database.close();
  });

  it('orders chunks by cosine distance, nearest first', async () => {
    const { documentId } = await seedDocument([
      { content: 'far', embedding: vector(1) },
      { content: 'exact', embedding: vector(0) },
      { content: 'near', embedding: vector(0, { axis: 1, weight: 0.2 }) },
    ]);
    const query = vector(0);

    const rows = await database.db
      .select({
        content: documentChunks.content,
        distance: cosineDistance(documentChunks.embedding, query),
      })
      .from(documentChunks)
      .where(eq(documentChunks.documentId, documentId))
      .orderBy(cosineDistance(documentChunks.embedding, query));

    expect(rows.map((row) => row.content)).toEqual(['exact', 'near', 'far']);
    expect(Number(rows[0]?.distance)).toBeCloseTo(0, 5);
  });

  it("never returns another user's chunks when filtered by document and owner", async () => {
    const mine = await seedDocument([{ content: 'mine', embedding: vector(0) }]);
    const theirs = await seedDocument([{ content: 'theirs', embedding: vector(0) }]);
    const query = vector(0);

    const rows = await database.db
      .select({ content: documentChunks.content })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.documentId, theirs.documentId),
          eq(documentChunks.userId, mine.userId),
        ),
      )
      .orderBy(cosineDistance(documentChunks.embedding, query));

    expect(rows).toEqual([]);
  });

  it('deletes chunks together with their document', async () => {
    const { documentId } = await seedDocument([{ content: 'gone soon', embedding: vector(2) }]);

    await database.db.delete(documents).where(eq(documents.id, documentId));

    const remaining = await database.db
      .select()
      .from(documentChunks)
      .where(eq(documentChunks.documentId, documentId));
    expect(remaining).toEqual([]);
  });

  it('rejects embeddings with the wrong dimension count', async () => {
    const attempt = seedDocument([{ content: 'bad', embedding: [1, 2, 3] }]);
    await expect(attempt).rejects.toThrow();
  });
});
