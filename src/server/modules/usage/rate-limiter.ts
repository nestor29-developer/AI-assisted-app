import { sql } from 'drizzle-orm';

import type { Database } from '@/server/core/db/client';
import { rateLimitWindows } from '@/server/core/db/schema';
import { RateLimitedError } from '@/server/core/errors';

export interface RateLimitPolicy {
  readonly key: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(policy: RateLimitPolicy): Promise<RateLimitResult>;
}

/** Fixed-window counter in one atomic upsert, so it stays correct across app instances. */
export class PostgresRateLimiter implements RateLimiter {
  constructor(private readonly db: Database) {}

  async consume({ key, limit, windowSeconds }: RateLimitPolicy): Promise<RateLimitResult> {
    // The database clock decides the window, so instances with skewed clocks still agree.
    const windowStart = sql`to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}::int) * ${windowSeconds}::int)`;

    const [row] = await this.db
      .insert(rateLimitWindows)
      .values({ key, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimitWindows.key, rateLimitWindows.windowStart],
        set: { count: sql`${rateLimitWindows.count} + 1` },
      })
      .returning({
        count: rateLimitWindows.count,
        retryAfterSeconds:
          sql<number>`ceil(extract(epoch from (${rateLimitWindows.windowStart} + make_interval(secs => ${windowSeconds}::int) - now())))`.mapWith(
            Number,
          ),
      });
    if (!row) throw new Error('Rate limit upsert returned no row');

    return {
      allowed: row.count <= limit,
      remaining: Math.max(0, limit - row.count),
      retryAfterSeconds: Math.max(1, row.retryAfterSeconds),
    };
  }
}

export async function enforceRateLimit(
  limiter: RateLimiter,
  policy: RateLimitPolicy,
): Promise<void> {
  const result = await limiter.consume(policy);
  if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
}
