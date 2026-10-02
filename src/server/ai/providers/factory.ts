import type { AppConfig } from '@/server/core/config/env';

import { MockEmbeddingProvider } from './mock-embedding';
import { MockLlmProvider } from './mock-llm';
import type { EmbeddingProvider, LlmProvider } from './types';

export interface AiProviders {
  readonly llm: LlmProvider;
  readonly embeddings: EmbeddingProvider;
}

/** Strategy selection from config; the rest of the app only ever sees the two ports. */
export function createAiProviders(config: AppConfig['ai']): AiProviders {
  switch (config.provider) {
    case 'mock':
      return {
        llm: new MockLlmProvider({ chunkDelayMs: 15 }),
        embeddings: new MockEmbeddingProvider(),
      };
    case 'gemini':
      throw new Error('The Gemini adapters are wired in a later step');
  }
}
