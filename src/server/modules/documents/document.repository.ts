import { and, desc, eq } from 'drizzle-orm';

import type { Database } from '@/server/core/db/client';
import { documentChunks, documents } from '@/server/core/db/schema';

export interface DocumentRecord {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly sourceType: 'text' | 'file';
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly pageCount: number | null;
  readonly content: string;
  readonly tokenEstimate: number;
  readonly chunkCount: number;
  readonly embeddingModel: string;
  readonly chunkerVersion: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/** Lists never need the (potentially large) extracted text. */
export type DocumentSummaryRecord = Omit<DocumentRecord, 'content'>;

export type NewDocument = Omit<DocumentRecord, 'id' | 'chunkCount' | 'createdAt'>;

export interface NewChunk {
  readonly ordinal: number;
  readonly page: number | null;
  readonly content: string;
  readonly embedding: readonly number[];
}

export interface DocumentRepository {
  /** Document and chunks are stored together or not at all. */
  createWithChunks(document: NewDocument, chunks: readonly NewChunk[]): Promise<DocumentRecord>;
  /** Metadata only: the extracted text can be hundreds of KB and no read path needs it. */
  findById(userId: string, id: string): Promise<DocumentSummaryRecord | null>;
  listByUser(userId: string): Promise<DocumentSummaryRecord[]>;
  /** Returns false when the document does not exist or belongs to someone else. */
  delete(userId: string, id: string): Promise<boolean>;
}

const INSERT_BATCH_SIZE = 100;

/** Everything but `content`; the return type of listByUser fails to compile if one goes missing. */
const summaryColumns = {
  id: documents.id,
  userId: documents.userId,
  title: documents.title,
  sourceType: documents.sourceType,
  mimeType: documents.mimeType,
  sizeBytes: documents.sizeBytes,
  pageCount: documents.pageCount,
  tokenEstimate: documents.tokenEstimate,
  chunkCount: documents.chunkCount,
  embeddingModel: documents.embeddingModel,
  chunkerVersion: documents.chunkerVersion,
  createdAt: documents.createdAt,
  expiresAt: documents.expiresAt,
};

export class DrizzleDocumentRepository implements DocumentRepository {
  constructor(private readonly db: Database) {}

  async createWithChunks(
    document: NewDocument,
    chunks: readonly NewChunk[],
  ): Promise<DocumentRecord> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(documents)
        .values({ ...document, chunkCount: chunks.length })
        .returning();
      if (!row) throw new Error('Insert into documents returned no row');

      for (let start = 0; start < chunks.length; start += INSERT_BATCH_SIZE) {
        const batch = chunks.slice(start, start + INSERT_BATCH_SIZE);
        await tx.insert(documentChunks).values(
          batch.map((chunk) => ({
            documentId: row.id,
            userId: document.userId,
            ordinal: chunk.ordinal,
            page: chunk.page,
            content: chunk.content,
            embedding: [...chunk.embedding],
          })),
        );
      }
      return row;
    });
  }

  async findById(userId: string, id: string): Promise<DocumentSummaryRecord | null> {
    const [row] = await this.db
      .select(summaryColumns)
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async listByUser(userId: string): Promise<DocumentSummaryRecord[]> {
    return this.db
      .select(summaryColumns)
      .from(documents)
      .where(eq(documents.userId, userId))
      .orderBy(desc(documents.createdAt));
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .returning({ id: documents.id });
    return deleted.length > 0;
  }
}
