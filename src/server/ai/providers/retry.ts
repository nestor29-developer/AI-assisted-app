export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** Injected so tests need neither real time nor real randomness. */
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly random: () => number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  sleep: abortableSleep,
  random: Math.random,
};

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Full jitter: a random wait up to the exponential ceiling, so retrying clients spread out. */
export function backoffDelayMs(attempt: number, policy: RetryPolicy): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.floor(policy.random() * ceiling);
}

/** A provider's Retry-After is honoured, but never beyond the cap: we would rather fail fast. */
export function resolveDelayMs(
  attempt: number,
  retryAfterMs: number | undefined,
  policy: RetryPolicy,
): number | null {
  if (retryAfterMs === undefined) return backoffDelayMs(attempt, policy);
  return retryAfterMs <= policy.maxDelayMs ? retryAfterMs : null;
}
