import type {
  RateLimitPolicy,
  RateLimitResult,
  RateLimiter,
} from '@/server/modules/usage/rate-limiter';

/** Same fixed-window semantics as the Postgres limiter, with a controllable clock. */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly counts = new Map<string, number>();

  constructor(private nowMs: () => number = Date.now) {}

  advance(ms: number): void {
    const previous = this.nowMs;
    this.nowMs = () => previous() + ms;
  }

  async consume({ key, limit, windowSeconds }: RateLimitPolicy): Promise<RateLimitResult> {
    const windowMs = windowSeconds * 1000;
    const windowStart = Math.floor(this.nowMs() / windowMs) * windowMs;
    const slot = `${key}@${windowStart}`;
    const count = (this.counts.get(slot) ?? 0) + 1;
    this.counts.set(slot, count);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - this.nowMs()) / 1000)),
    };
  }

  get keys(): string[] {
    return [...this.counts.keys()];
  }
}
