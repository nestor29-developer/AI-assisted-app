import { and, asc, cosineDistance, eq } from 'drizzle-orm';

import type { Database } from '@/server/core/db/client';
import { documentChunks } from '@/server/core/db/schema';

export interface ChunkRecord {
  readonly id: string;
  readonly ordinal: number;
  readonly page: number | null;
  readonly content: string;
}

export interface ScoredChunk extends ChunkRecord {
  /** Cosine similarity: 1 is identical, 0 unrelated. */
  readonly score: number;
}

/** Every method takes the owner, so a missing filter is a compile error, not a data leak. */
export interface ChunkRepository {
  listByDocument(userId: string, documentId: string): Promise<ChunkRecord[]>;
  searchSimilar(
    userId: string,
    documentId: string,
    vector: readonly number[],
    limit: number,
  ): Promise<ScoredChunk[]>;
}

export class DrizzleChunkRepository implements ChunkRepository {
  constructor(private readonly db: Database) {}

  async listByDocument(userId: string, documentId: string): Promise<ChunkRecord[]> {
    return this.db
      .select({
        id: documentChunks.id,
        ordinal: documentChunks.ordinal,
        page: documentChunks.page,
        content: documentChunks.content,
      })
      .from(documentChunks)
      .where(and(eq(documentChunks.documentId, documentId), eq(documentChunks.userId, userId)))
      .orderBy(asc(documentChunks.ordinal));
  }

  /** Exact search: the filter leaves one document's chunks, so an ANN index would only cost recall. */
  async searchSimilar(
    userId: string,
    documentId: string,
    vector: readonly number[],
    limit: number,
  ): Promise<ScoredChunk[]> {
    const distance = cosineDistance(documentChunks.embedding, [...vector]);
    const rows = await this.db
      .select({
        id: documentChunks.id,
        ordinal: documentChunks.ordinal,
        page: documentChunks.page,
        content: documentChunks.content,
        distance,
      })
      .from(documentChunks)
      .where(and(eq(documentChunks.documentId, documentId), eq(documentChunks.userId, userId)))
      .orderBy(distance)
      .limit(limit);

    return rows.map(({ distance: d, ...chunk }) => ({ ...chunk, score: 1 - Number(d) }));
  }
}
