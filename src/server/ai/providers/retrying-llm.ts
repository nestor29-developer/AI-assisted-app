import { AiProviderError } from './errors';
import { DEFAULT_RETRY_POLICY, resolveDelayMs, type RetryPolicy } from './retry';
import type { LlmEvent, LlmProvider, LlmRequest } from './types';

/** Decorator: retries transient failures, but only before the first event reaches the caller. */
export class RetryingLlmProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;

  constructor(
    private readonly inner: LlmProvider,
    private readonly policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  ) {
    this.name = inner.name;
    this.model = inner.model;
  }

  async *generateStream(request: LlmRequest): AsyncGenerator<LlmEvent> {
    for (let attempt = 1; ; attempt += 1) {
      let started = false;
      try {
        for await (const event of this.inner.generateStream(request)) {
          started = true;
          yield event;
        }
        return;
      } catch (error) {
        const delay = this.delayAfter(error, attempt, started, request.signal);
        if (delay === null) throw error;
        await this.policy.sleep(delay, request.signal);
      }
    }
  }

  private delayAfter(
    error: unknown,
    attempt: number,
    started: boolean,
    signal: AbortSignal | undefined,
  ): number | null {
    // Once text has been streamed, a retry would repeat it for the user.
    if (started || signal?.aborted) return null;
    if (!(error instanceof AiProviderError) || !error.retryable) return null;
    if (attempt >= this.policy.maxAttempts) return null;
    return resolveDelayMs(attempt, error.retryAfterMs, this.policy);
  }
}
