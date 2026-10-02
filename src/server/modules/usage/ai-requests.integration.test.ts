import { eq, inArray, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { aiRequests, users } from '@/server/core/db/schema';
import {
  aiRequestContract,
  completion,
  POLICY,
  reserveRequest,
} from '@/test/contracts/ai-requests.contract';
import { connectTestDatabase } from '@/test/helpers/database';
import { seedUser } from '@/test/helpers/seed';

import { DrizzleAiRequestRepository } from './ai-request.repository';

aiRequestContract('Drizzle (real Postgres)', async () => {
  const { db, close } = await connectTestDatabase();
  const created: string[] = [];
  return {
    requests: new DrizzleAiRequestRepository(db),
    newUser: async () => {
      const id = await seedUser(db);
      created.push(id);
      return id;
    },
    cleanup: async () => {
      await db.delete(users).where(inArray(users.id, created));
      await close();
    },
  };
});

describe('DrizzleAiRequestRepository: time-dependent rules (rows aged with SQL)', () => {
  async function setup() {
    const { db, close } = await connectTestDatabase();
    const userId = await seedUser(db);
    const requests = new DrizzleAiRequestRepository(db);
    const age = (id: string, seconds: number) =>
      db
        .update(aiRequests)
        .set({ createdAt: sql`now() - make_interval(secs => ${seconds}::double precision)` })
        .where(eq(aiRequests.id, id));
    const cleanup = async () => {
      await db.delete(users).where(eq(users.id, userId));
      await close();
    };
    return { requests, userId, age, cleanup };
  }

  it('ignores reservations from dead tasks once they are stale', async () => {
    const { requests, userId, age, cleanup } = await setup();
    try {
      const a = await requests.reserve(reserveRequest(userId, 100));
      const b = await requests.reserve(reserveRequest(userId, 100));
      expect(await requests.reserve(reserveRequest(userId))).toMatchObject({
        ok: false,
        reason: 'concurrency',
      });

      for (const r of [a, b]) if (r.ok) await age(r.id, POLICY.staleAfterSeconds + 5);

      expect(await requests.reserve(reserveRequest(userId))).toMatchObject({ ok: true });
    } finally {
      await cleanup();
    }
  });

  it('forgets usage older than the window and reports when room opens up', async () => {
    const { requests, userId, age, cleanup } = await setup();
    try {
      const first = await requests.reserve(reserveRequest(userId, 9_000));
      if (!first.ok) throw new Error('setup failed');
      await requests.finalize(completion(first.id, { input: 9_000, output: 0, thinking: 0 }));

      const blocked = await requests.reserve(reserveRequest(userId, 5_000));
      expect(blocked).toMatchObject({ ok: false, reason: 'quota' });
      expect(blocked.ok === false && blocked.retryAfterSeconds).toBeGreaterThan(86_000);

      await age(first.id, POLICY.windowSeconds + 10);

      expect(await requests.reserve(reserveRequest(userId, 5_000))).toMatchObject({ ok: true });
    } finally {
      await cleanup();
    }
  });
});
