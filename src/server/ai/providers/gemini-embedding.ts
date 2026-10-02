import { GoogleGenAI, type EmbedContentParameters, type EmbedContentResponse } from '@google/genai';

import { EMBEDDING_DIMENSIONS } from '@/server/core/constants';
import { estimateTokens } from '@/server/ai/tokens';

import { AiProviderError } from './errors';
import { mapGeminiError } from './gemini-errors';
import type { EmbedOptions, EmbeddingProvider, EmbeddingPurpose, EmbeddingResult } from './types';

export interface GeminiEmbeddingClient {
  models: { embedContent(params: EmbedContentParameters): Promise<EmbedContentResponse> };
}

export interface GeminiEmbeddingOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly client?: GeminiEmbeddingClient;
}

/** gemini-embedding-2 has no task-type parameter: the task is declared in the text itself. */
function formatInput(text: string, purpose: EmbeddingPurpose, title: string | undefined): string {
  return purpose === 'query'
    ? `task: question answering | query: ${text}`
    : `title: ${title?.trim() || 'none'} | text: ${text}`;
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'gemini';
  readonly model: string;
  readonly dimensions = EMBEDDING_DIMENSIONS;
  private readonly client: GeminiEmbeddingClient;

  constructor({ apiKey, model, client }: GeminiEmbeddingOptions) {
    this.model = model;
    this.client = client ?? new GoogleGenAI({ apiKey });
  }

  async embed(
    texts: readonly string[],
    purpose: EmbeddingPurpose,
    options: EmbedOptions = {},
  ): Promise<EmbeddingResult> {
    const inputs = texts.map((text) => formatInput(text, purpose, options.title));

    let response: EmbedContentResponse;
    try {
      response = await this.client.models.embedContent({
        model: this.model,
        // One Content per text: plain parts in a single Content would be merged into ONE embedding.
        contents: inputs.map((text) => ({ parts: [{ text }] })),
        config: {
          outputDimensionality: this.dimensions,
          ...(options.signal ? { abortSignal: options.signal } : {}),
        },
      });
    } catch (error) {
      throw mapGeminiError(error);
    }

    const vectors = (response.embeddings ?? []).map((embedding) => embedding.values ?? []);
    if (
      vectors.length !== inputs.length ||
      vectors.some((vector) => vector.length !== this.dimensions)
    ) {
      throw new AiProviderError('The embedding response did not match the request', {
        retryable: false,
      });
    }
    return { vectors, inputTokens: inputs.reduce((sum, text) => sum + estimateTokens(text), 0) };
  }
}
