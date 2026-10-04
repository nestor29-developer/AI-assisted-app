import { EMBEDDING_DIMENSIONS } from '@/server/core/constants';
import type {
  ChunkRecord,
  ChunkRepository,
  ScoredChunk,
} from '@/server/modules/documents/chunk.repository';
import type {
  DocumentRecord,
  DocumentRepository,
  DocumentSummaryRecord,
  NewChunk,
  NewDocument,
} from '@/server/modules/documents/document.repository';

interface StoredChunk extends ChunkRecord {
  readonly userId: string;
  readonly embedding: readonly number[];
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    normA += a[i]! ** 2;
    normB += b[i]! ** 2;
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

const hasExpired = (record: DocumentRecord) => record.expiresAt.getTime() <= Date.now();

function toSummary(record: DocumentRecord): DocumentSummaryRecord {
  return {
    id: record.id,
    userId: record.userId,
    title: record.title,
    sourceType: record.sourceType,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    pageCount: record.pageCount,
    tokenEstimate: record.tokenEstimate,
    chunkCount: record.chunkCount,
    embeddingModel: record.embeddingModel,
    chunkerVersion: record.chunkerVersion,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

/** One in-memory store behind both repository ports, mirroring the constraints the schema enforces. */
export class InMemoryDocumentStore implements DocumentRepository, ChunkRepository {
  private readonly documents = new Map<string, DocumentRecord>();
  private readonly chunks = new Map<string, StoredChunk[]>();

  async createWithChunks(
    document: NewDocument,
    chunks: readonly NewChunk[],
  ): Promise<DocumentRecord> {
    const ordinals = new Set(chunks.map((chunk) => chunk.ordinal));
    if (ordinals.size !== chunks.length) throw new Error('duplicate chunk ordinal');
    if (chunks.some((chunk) => chunk.embedding.length !== EMBEDDING_DIMENSIONS)) {
      throw new Error(`embedding must have ${EMBEDDING_DIMENSIONS} dimensions`);
    }

    const record: DocumentRecord = {
      ...document,
      id: crypto.randomUUID(),
      chunkCount: chunks.length,
      createdAt: new Date(),
    };
    this.documents.set(record.id, record);
    this.chunks.set(
      record.id,
      chunks.map(({ ordinal, page, content, embedding }) => ({
        id: crypto.randomUUID(),
        userId: document.userId,
        ordinal,
        page,
        content,
        embedding,
      })),
    );
    return record;
  }

  async findById(userId: string, id: string): Promise<DocumentSummaryRecord | null> {
    const record = this.documents.get(id);
    if (record?.userId !== userId || hasExpired(record)) return null;
    return toSummary(record);
  }

  async listByUser(userId: string): Promise<DocumentSummaryRecord[]> {
    return [...this.documents.values()]
      .filter((record) => record.userId === userId && !hasExpired(record))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(toSummary);
  }

  async delete(userId: string, id: string): Promise<boolean> {
    if (this.documents.get(id)?.userId !== userId) return false;
    this.documents.delete(id);
    this.chunks.delete(id);
    return true;
  }

  async listByDocument(userId: string, documentId: string): Promise<ChunkRecord[]> {
    return this.ownedChunks(userId, documentId)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(({ id, ordinal, page, content }) => ({ id, ordinal, page, content }));
  }

  async searchSimilar(
    userId: string,
    documentId: string,
    vector: readonly number[],
    limit: number,
  ): Promise<ScoredChunk[]> {
    return this.ownedChunks(userId, documentId)
      .map(({ id, ordinal, page, content, embedding }) => ({
        id,
        ordinal,
        page,
        content,
        score: cosine(embedding, vector),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private ownedChunks(userId: string, documentId: string): StoredChunk[] {
    return (this.chunks.get(documentId) ?? []).filter((chunk) => chunk.userId === userId);
  }
}
