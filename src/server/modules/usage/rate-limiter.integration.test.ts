import { randomUUID } from 'node:crypto';

import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { rateLimitWindows } from '@/server/core/db/schema';
import { connectTestDatabase } from '@/test/helpers/database';

import { PostgresRateLimiter } from './rate-limiter';

type TestDatabase = Awaited<ReturnType<typeof connectTestDatabase>>;

describe('PostgresRateLimiter (real Postgres)', () => {
  let database: TestDatabase;
  let limiter: PostgresRateLimiter;
  const usedKeys: string[] = [];
  const freshKey = () => {
    const key = `test:${randomUUID()}`;
    usedKeys.push(key);
    return key;
  };

  beforeAll(async () => {
    database = await connectTestDatabase();
    limiter = new PostgresRateLimiter(database.db);
  });

  afterAll(async () => {
    await database.db.delete(rateLimitWindows).where(inArray(rateLimitWindows.key, usedKeys));
    await database.close();
  });

  it('counts calls in a window and blocks once the limit is exceeded', async () => {
    const policy = { key: freshKey(), limit: 3, windowSeconds: 60 };
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await limiter.consume(policy));

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0, 0]);
  });

  it('reports a sensible retry-after inside the window', async () => {
    const result = await limiter.consume({ key: freshKey(), limit: 1, windowSeconds: 60 });

    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('is atomic under concurrency: exactly `limit` of many parallel calls succeed', async () => {
    const policy = { key: freshKey(), limit: 5, windowSeconds: 60 };

    const results = await Promise.all(Array.from({ length: 25 }, () => limiter.consume(policy)));

    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  it('keeps keys independent', async () => {
    const a = { key: freshKey(), limit: 1, windowSeconds: 60 };
    const b = { key: freshKey(), limit: 1, windowSeconds: 60 };

    await limiter.consume(a);

    expect((await limiter.consume(a)).allowed).toBe(false);
    expect((await limiter.consume(b)).allowed).toBe(true);
  });

  it('starts a fresh window once the previous one has passed', async () => {
    const policy = { key: freshKey(), limit: 1, windowSeconds: 1 };
    await limiter.consume(policy);
    expect((await limiter.consume(policy)).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect((await limiter.consume(policy)).allowed).toBe(true);
  });
});
