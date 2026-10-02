import { AiProviderError } from './errors';
import { DEFAULT_RETRY_POLICY, resolveDelayMs, type RetryPolicy } from './retry';
import type { EmbedOptions, EmbeddingProvider, EmbeddingPurpose, EmbeddingResult } from './types';

/** Embeddings are a single request/response, so every transient failure is safe to retry. */
export class RetryingEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;

  constructor(
    private readonly inner: EmbeddingProvider,
    private readonly policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  ) {
    this.name = inner.name;
    this.model = inner.model;
    this.dimensions = inner.dimensions;
  }

  async embed(
    texts: readonly string[],
    purpose: EmbeddingPurpose,
    options?: EmbedOptions,
  ): Promise<EmbeddingResult> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.inner.embed(texts, purpose, options);
      } catch (error) {
        const delay = this.delayAfter(error, attempt, options?.signal);
        if (delay === null) throw error;
        await this.policy.sleep(delay, options?.signal);
      }
    }
  }

  private delayAfter(
    error: unknown,
    attempt: number,
    signal: AbortSignal | undefined,
  ): number | null {
    if (signal?.aborted) return null;
    if (!(error instanceof AiProviderError) || !error.retryable) return null;
    if (attempt >= this.policy.maxAttempts) return null;
    return resolveDelayMs(attempt, error.retryAfterMs, this.policy);
  }
}
