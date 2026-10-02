export interface AiProviderErrorOptions {
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly status?: number;
  readonly cause?: unknown;
}

/** Any failure talking to a model provider, already classified as worth retrying or not. */
export class AiProviderError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly status: number | undefined;

  constructor(message: string, options: AiProviderErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AiProviderError';
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs;
    this.status = options.status;
  }
}
