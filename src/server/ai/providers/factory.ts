import type { AppConfig } from '@/server/core/config/env';

import { GeminiEmbeddingProvider } from './gemini-embedding';
import { GeminiLlmProvider } from './gemini-llm';
import { MockEmbeddingProvider } from './mock-embedding';
import { MockLlmProvider } from './mock-llm';
import { RetryingEmbeddingProvider } from './retrying-embedding';
import { RetryingLlmProvider } from './retrying-llm';
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
    case 'gemini': {
      const { geminiApiKey: apiKey } = config;
      if (!apiKey) throw new Error('GEMINI_API_KEY is required when LLM_PROVIDER=gemini');
      return {
        llm: new RetryingLlmProvider(new GeminiLlmProvider({ apiKey, model: config.llmModel })),
        embeddings: new RetryingEmbeddingProvider(
          new GeminiEmbeddingProvider({ apiKey, model: config.embeddingModel }),
        ),
      };
    }
  }
}
