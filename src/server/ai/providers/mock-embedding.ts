import { EMBEDDING_DIMENSIONS } from '@/server/core/constants';
import { estimateTokens } from '@/server/ai/tokens';

import { significantTokens } from './mock-text';
import type { EmbeddingProvider, EmbeddingResult } from './types';

/** FNV-1a: a tiny, stable string hash, so the same text always lands in the same buckets. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function embedText(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const token of significantTokens(text)) {
    const hash = fnv1a(token);
    vector[hash % EMBEDDING_DIMENSIONS]! += hash & 0x80000000 ? -1 : 1;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector.map((_, index) => (index === 0 ? 1 : 0));
  return vector.map((value) => value / norm);
}

/** Deterministic hashed bag-of-words vectors: related texts score close, so retrieval works offline. */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'mock';
  readonly model = 'mock-hashed-bow-1';
  readonly dimensions = EMBEDDING_DIMENSIONS;

  async embed(texts: readonly string[]): Promise<EmbeddingResult> {
    return {
      vectors: texts.map(embedText),
      inputTokens: texts.reduce((sum, text) => sum + estimateTokens(text), 0),
    };
  }
}
