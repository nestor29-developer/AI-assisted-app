import { describe, expect, it } from 'vitest';

import {
  aiRequestContract,
  completion,
  POLICY,
  reserveRequest,
} from '@/test/contracts/ai-requests.contract';

import { InMemoryAiRequestRepository } from './ai-request-repository';

aiRequestContract('InMemoryAiRequestRepository', async () => ({
  requests: new InMemoryAiRequestRepository(),
  newUser: async () => crypto.randomUUID(),
  cleanup: async () => {},
}));

describe('InMemoryAiRequestRepository: time-dependent rules', () => {
  const user = crypto.randomUUID();

  it('ignores reservations from dead tasks once they are stale (a deploy must not lock users out)', async () => {
    const requests = new InMemoryAiRequestRepository();
    await requests.reserve(reserveRequest(user, 100));
    await requests.reserve(reserveRequest(user, 100));
    expect(await requests.reserve(reserveRequest(user))).toMatchObject({
      ok: false,
      reason: 'concurrency',
    });

    requests.advance((POLICY.staleAfterSeconds + 1) * 1000);

    expect(await requests.reserve(reserveRequest(user))).toMatchObject({ ok: true });
  });

  it('forgets usage that has left the 24 hour window, and says when room opens up', async () => {
    const requests = new InMemoryAiRequestRepository();
    const first = await requests.reserve(reserveRequest(user, 9_000));
    if (!first.ok) throw new Error('setup failed');
    await requests.finalize(completion(first.id, { input: 9_000, output: 0, thinking: 0 }));

    const blocked = await requests.reserve(reserveRequest(user, 5_000));
    expect(blocked).toMatchObject({ ok: false, reason: 'quota' });
    expect(blocked.ok === false && blocked.retryAfterSeconds).toBeGreaterThan(86_000);

    requests.advance(POLICY.windowSeconds * 1000 + 1_000);

    expect(await requests.reserve(reserveRequest(user, 5_000))).toMatchObject({ ok: true });
  });
});
