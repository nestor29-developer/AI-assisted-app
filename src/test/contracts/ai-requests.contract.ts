import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  AiRequestRepository,
  ReservationPolicy,
  ReserveRequest,
} from '@/server/modules/usage/ai-request.repository';

export interface AiRequestHarness {
  readonly requests: AiRequestRepository;
  /** A brand-new user, so quota state never leaks from one test into the next. */
  newUser(): Promise<string>;
  cleanup(): Promise<void>;
}

export const POLICY: ReservationPolicy = {
  maxConcurrent: 2,
  dailyBudgetTokens: 10_000,
  windowSeconds: 86_400,
  staleAfterSeconds: 600,
};

export const reserveRequest = (userId: string, estimatedTokens = 1_000): ReserveRequest => ({
  userId,
  documentId: null,
  provider: 'mock',
  model: 'mock',
  promptId: 'document-qa',
  promptVersion: 'v1',
  appVersion: 'test',
  estimatedTokens,
  policy: POLICY,
});

export const completion = (
  id: string,
  tokens: { input: number; output: number; thinking: number },
) => ({
  id,
  outcome: 'success' as const,
  usage: {
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    thinkingTokens: tokens.thinking,
  },
  costUsd: 0.002,
  latencyMs: 120,
  ttftMs: 40,
  finishReason: 'STOP',
  contextStrategy: 'full' as const,
  retrieval: null,
  injectionFlag: false,
});

/** Quota and concurrency rules every implementation must enforce; Postgres adds locking on top. */
export function aiRequestContract(name: string, connect: () => Promise<AiRequestHarness>) {
  describe(`${name}: AI request accounting`, () => {
    let h: AiRequestHarness;
    beforeAll(async () => {
      h = await connect();
    });
    afterAll(() => h.cleanup());

    async function reserveOk(userId: string, tokens = 1_000) {
      const result = await h.requests.reserve(reserveRequest(userId, tokens));
      if (!result.ok) throw new Error(`expected a reservation, got ${result.reason}`);
      return result.id;
    }

    it('records an in-progress reservation', async () => {
      const user = await h.newUser();
      const id = await reserveOk(user, 2_500);

      expect(await h.requests.findById(id)).toMatchObject({
        userId: user,
        operation: 'chat',
        outcome: 'in_progress',
        reservedTokens: 2_500,
        inputTokens: null,
      });
      await h.requests.finalize({ ...completion(id, { input: 1, output: 1, thinking: 0 }) });
    });

    it('caps concurrent in-flight requests per user, and frees a slot when one finishes', async () => {
      const user = await h.newUser();
      const first = await reserveOk(user);
      const second = await reserveOk(user);

      const blocked = await h.requests.reserve(reserveRequest(user));
      expect(blocked).toEqual({ ok: false, reason: 'concurrency', retryAfterSeconds: 5 });

      await h.requests.finalize(completion(first, { input: 10, output: 5, thinking: 0 }));
      const third = await reserveOk(user);

      await h.requests.finalize(completion(second, { input: 1, output: 1, thinking: 0 }));
      await h.requests.finalize(completion(third, { input: 1, output: 1, thinking: 0 }));
    });

    it('counts reservations against the daily budget, then real usage once finished', async () => {
      const user = await h.newUser();
      const first = await reserveOk(user, 6_000);

      const overBudget = await h.requests.reserve(reserveRequest(user, 6_000));
      expect(overBudget).toMatchObject({ ok: false, reason: 'quota' });
      expect(overBudget.ok === false && overBudget.retryAfterSeconds).toBeGreaterThanOrEqual(60);

      // The reservation was 6000, but only 1000 were really used, so room opens up.
      await h.requests.finalize(completion(first, { input: 800, output: 100, thinking: 100 }));
      const second = await reserveOk(user, 6_000);
      await h.requests.finalize(completion(second, { input: 1, output: 1, thinking: 0 }));
    });

    it('treats reasoning tokens as usage', async () => {
      const user = await h.newUser();
      const id = await reserveOk(user, 100);
      await h.requests.finalize(completion(id, { input: 100, output: 100, thinking: 9_000 }));

      expect(await h.requests.reserve(reserveRequest(user, 1_000))).toMatchObject({
        ok: false,
        reason: 'quota',
      });
    });

    it('releases the reservation when a request fails or is cancelled', async () => {
      const user = await h.newUser();
      const id = await reserveOk(user, 9_000);
      await h.requests.finalize({
        ...completion(id, { input: 0, output: 0, thinking: 0 }),
        outcome: 'error',
        usage: null,
      });

      await expect(reserveOk(user, 9_000)).resolves.toBeTruthy();
    });

    it('keeps users independent', async () => {
      const heavy = await reserveOk(await h.newUser(), 9_500);

      await expect(reserveOk(await h.newUser(), 9_500)).resolves.toBeTruthy();
      await h.requests.finalize(completion(heavy, { input: 1, output: 1, thinking: 0 }));
    });

    it('lets exactly the allowed number of simultaneous requests through (no race past the cap)', async () => {
      const user = await h.newUser();

      const results = await Promise.all(
        Array.from({ length: 8 }, () => h.requests.reserve(reserveRequest(user, 100))),
      );

      const granted = results.filter((r) => r.ok);
      expect(granted).toHaveLength(2);
      expect(results.filter((r) => !r.ok && r.reason === 'concurrency')).toHaveLength(6);
      for (const result of granted) {
        if (result.ok)
          await h.requests.finalize(completion(result.id, { input: 1, output: 1, thinking: 0 }));
      }
    });

    it('finalizes once: a finished request is not overwritten', async () => {
      const id = await reserveOk(await h.newUser(), 500);
      await h.requests.finalize({
        ...completion(id, { input: 10, output: 20, thinking: 0 }),
        retrieval: [{ chunkId: 'c1', score: 0.9 }],
      });

      await h.requests.finalize({
        ...completion(id, { input: 999, output: 999, thinking: 0 }),
        outcome: 'error',
      });

      expect(await h.requests.findById(id)).toMatchObject({
        outcome: 'success',
        inputTokens: 10,
        outputTokens: 20,
        estimatedCostUsd: 0.002,
        contextStrategy: 'full',
        retrieval: [{ chunkId: 'c1', score: 0.9 }],
      });
    });

    it('ignores a finalize for an unknown request', async () => {
      await expect(
        h.requests.finalize(completion(crypto.randomUUID(), { input: 1, output: 1, thinking: 0 })),
      ).resolves.toBeUndefined();
    });

    it('logs embeddings without counting them against the chat budget', async () => {
      const user = await h.newUser();
      const id = await h.requests.recordEmbedding({
        userId: user,
        documentId: null,
        provider: 'mock',
        model: 'mock-embed',
        appVersion: 'test',
        inputTokens: 500_000,
        costUsd: 0.1,
        latencyMs: 900,
        injectionFlag: true,
      });

      expect(await h.requests.findById(id)).toMatchObject({
        operation: 'embed_document',
        outcome: 'success',
        inputTokens: 500_000,
        injectionFlag: true,
      });
      await expect(reserveOk(user, 9_000)).resolves.toBeTruthy();
    });

    it('marks reservations left by dead tasks as errors so they stop blocking the user', async () => {
      const user = await h.newUser();
      const stuckOne = await reserveOk(user, 100);
      const stuckTwo = await reserveOk(user, 100);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const swept = await h.requests.markStale(0);

      expect(swept).toBeGreaterThanOrEqual(2);
      expect(await h.requests.findById(stuckOne)).toMatchObject({
        outcome: 'error',
        finishReason: 'stale',
      });
      expect(await h.requests.findById(stuckTwo)).toMatchObject({ outcome: 'error' });
      await expect(reserveOk(user, 100)).resolves.toBeTruthy();
    });
  });
}
