import type { EmbeddingProvider } from '@/server/ai/providers/types';
import { ConflictError } from '@/server/core/errors';
import type { ChunkRepository } from '@/server/modules/documents/chunk.repository';
import type { DocumentSummaryRecord } from '@/server/modules/documents/document.repository';

/** All the selector needs to know about a document. */
export type SelectableDocument = Pick<
  DocumentSummaryRecord,
  'id' | 'userId' | 'tokenEstimate' | 'embeddingModel'
>;

export type ContextStrategyName = 'full' | 'retrieval';

export interface SelectedSource {
  readonly chunkId: string;
  readonly ordinal: number;
  readonly page: number | null;
  readonly text: string;
  /** Similarity to the question; null when the whole document is sent. */
  readonly score: number | null;
}

export interface ContextSelection {
  readonly strategy: ContextStrategyName;
  /** In document order, which reads more naturally to the model than rank order. */
  readonly sources: readonly SelectedSource[];
}

export interface ContextSelectorConfig {
  readonly fullContextMaxTokens: number;
  readonly topK: number;
}

export interface SelectInput {
  readonly document: SelectableDocument;
  readonly question: string;
  /** The user's previous question, so a follow-up like "and for managers?" still retrieves well. */
  readonly previousQuestion: string | null;
  readonly signal?: AbortSignal;
}

/** Small documents go to the model whole (better answers, "summarize" works); large ones are retrieved. */
export class ContextSelector {
  constructor(
    private readonly chunks: ChunkRepository,
    private readonly embeddings: EmbeddingProvider,
    private readonly config: ContextSelectorConfig,
  ) {}

  /** Cheap pre-flight: vectors from different models are not comparable, even when their sizes match. */
  assertUsable(document: SelectableDocument): void {
    const needsRetrieval = document.tokenEstimate > this.config.fullContextMaxTokens;
    if (needsRetrieval && document.embeddingModel !== this.embeddings.model) {
      throw new ConflictError(
        'This document was indexed with a different embedding model. Upload it again to ask questions.',
      );
    }
  }

  async select({
    document,
    question,
    previousQuestion,
    signal,
  }: SelectInput): Promise<ContextSelection> {
    const { userId, id } = document;

    if (document.tokenEstimate <= this.config.fullContextMaxTokens) {
      const all = await this.chunks.listByDocument(userId, id);
      return {
        strategy: 'full',
        sources: all.map((chunk) => ({
          chunkId: chunk.id,
          ordinal: chunk.ordinal,
          page: chunk.page,
          text: chunk.content,
          score: null,
        })),
      };
    }

    this.assertUsable(document);

    const query = previousQuestion ? `${previousQuestion}\n${question}` : question;
    const { vectors } = await this.embeddings.embed([query], 'query', signal ? { signal } : {});
    const hits = await this.chunks.searchSimilar(userId, id, vectors[0]!, this.config.topK);

    return {
      strategy: 'retrieval',
      sources: hits
        .map((hit) => ({
          chunkId: hit.id,
          ordinal: hit.ordinal,
          page: hit.page,
          text: hit.content,
          score: hit.score,
        }))
        .sort((a, b) => a.ordinal - b.ordinal),
    };
  }
}
