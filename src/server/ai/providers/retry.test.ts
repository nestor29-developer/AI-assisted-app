import { describe, expect, it, vi } from 'vitest';

import { AiProviderError } from './errors';
import type { RetryPolicy } from './retry';
import { abortableSleep, backoffDelayMs, resolveDelayMs } from './retry';
import { RetryingEmbeddingProvider } from './retrying-embedding';
import { RetryingLlmProvider } from './retrying-llm';
import type { EmbeddingProvider, LlmEvent, LlmProvider, LlmRequest } from './types';

const request: LlmRequest = {
  systemInstruction: 's',
  userContent: 'u',
  responseSchema: {},
  maxOutputTokens: 100,
  reasoningEffort: 'low',
};
const done: LlmEvent = {
  type: 'done',
  usage: { inputTokens: 1, outputTokens: 1, thinkingTokens: 0 },
  finishReason: 'stop',
  providerFinishReason: 'STOP',
};
const transient = (retryAfterMs?: number) =>
  new AiProviderError('boom', {
    retryable: true,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });

function policy(overrides: Partial<RetryPolicy> = {}) {
  const sleep = vi.fn(async () => {});
  return {
    sleep,
    policy: {
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      sleep,
      random: () => 0.5,
      ...overrides,
    } as RetryPolicy,
  };
}

/** Each script step is either events to emit (optionally followed by a throw) or an error to throw first. */
type Step = { emit?: LlmEvent[]; then?: unknown };
function scriptedLlm(steps: Step[]) {
  let call = 0;
  const provider: LlmProvider = {
    name: 'scripted',
    model: 'm',
    async *generateStream() {
      const step = steps[call++] ?? { emit: [done] };
      for (const event of step.emit ?? []) yield event;
      if (step.then !== undefined) throw step.then;
    },
  };
  return { provider, calls: () => call };
}

async function collect(stream: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const events: LlmEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('backoff math', () => {
  it('uses full jitter below an exponential ceiling that is capped', () => {
    const p = policy({ random: () => 0.999 }).policy;
    expect([1, 2, 3, 4, 5].map((attempt) => backoffDelayMs(attempt, p))).toEqual([
      99, 199, 399, 799, 999,
    ]);
    expect(backoffDelayMs(3, policy({ random: () => 0 }).policy)).toBe(0);
  });

  it('honours Retry-After up to the cap and gives up beyond it', () => {
    const { policy: p } = policy();
    expect(resolveDelayMs(1, 750, p)).toBe(750);
    expect(resolveDelayMs(1, 5_000, p)).toBeNull();
  });
});

describe('RetryingLlmProvider', () => {
  it('passes through a healthy stream without sleeping', async () => {
    const { policy: p, sleep } = policy();
    const { provider } = scriptedLlm([{ emit: [{ type: 'text', text: 'hi' }, done] }]);

    const events = await collect(new RetryingLlmProvider(provider, p).generateStream(request));

    expect(events).toHaveLength(2);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a transient failure that happens before any output', async () => {
    const { policy: p, sleep } = policy();
    const { provider, calls } = scriptedLlm([
      { then: transient() },
      { then: transient() },
      { emit: [done] },
    ]);

    const events = await collect(new RetryingLlmProvider(provider, p).generateStream(request));

    expect(events).toEqual([done]);
    expect(calls()).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxAttempts and rethrows the last error', async () => {
    const { policy: p } = policy({ maxAttempts: 2 });
    const { provider, calls } = scriptedLlm([
      { then: transient() },
      { then: transient() },
      { emit: [done] },
    ]);

    await expect(
      collect(new RetryingLlmProvider(provider, p).generateStream(request)),
    ).rejects.toBeInstanceOf(AiProviderError);
    expect(calls()).toBe(2);
  });

  it.each([
    ['a non-retryable provider error', new AiProviderError('bad key', { retryable: false })],
    ['an unexpected programming error', new TypeError('oops')],
  ])('does not retry %s', async (_label, error) => {
    const { policy: p, sleep } = policy();
    const { provider, calls } = scriptedLlm([{ then: error }]);

    await expect(
      collect(new RetryingLlmProvider(provider, p).generateStream(request)),
    ).rejects.toBe(error);
    expect(calls()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('never retries once text has been streamed, so users never see duplicated output', async () => {
    const { policy: p } = policy();
    const { provider, calls } = scriptedLlm([
      { emit: [{ type: 'text', text: 'partial' }], then: transient() },
    ]);
    const seen: LlmEvent[] = [];

    const run = async () => {
      for await (const event of new RetryingLlmProvider(provider, p).generateStream(request))
        seen.push(event);
    };

    await expect(run()).rejects.toBeInstanceOf(AiProviderError);
    expect(seen).toEqual([{ type: 'text', text: 'partial' }]);
    expect(calls()).toBe(1);
  });

  it('waits for the provider-supplied Retry-After, and fails fast when it is too long', async () => {
    const { policy: p, sleep } = policy();
    const short = scriptedLlm([{ then: transient(400) }, { emit: [done] }]);
    await collect(new RetryingLlmProvider(short.provider, p).generateStream(request));
    expect(sleep).toHaveBeenCalledWith(400, undefined);

    sleep.mockClear();
    const long = scriptedLlm([{ then: transient(60_000) }, { emit: [done] }]);
    await expect(
      collect(new RetryingLlmProvider(long.provider, p).generateStream(request)),
    ).rejects.toBeInstanceOf(AiProviderError);
    expect(sleep).not.toHaveBeenCalled();
    expect(long.calls()).toBe(1);
  });

  it('stops retrying once the caller has aborted', async () => {
    const { policy: p } = policy();
    const controller = new AbortController();
    const { provider, calls } = scriptedLlm([{ then: transient() }, { emit: [done] }]);
    controller.abort();

    await expect(
      collect(
        new RetryingLlmProvider(provider, p).generateStream({
          ...request,
          signal: controller.signal,
        }),
      ),
    ).rejects.toBeInstanceOf(AiProviderError);
    expect(calls()).toBe(1);
  });

  it('exposes the wrapped provider identity', () => {
    const { provider } = scriptedLlm([]);
    const wrapped = new RetryingLlmProvider(provider);
    expect([wrapped.name, wrapped.model]).toEqual(['scripted', 'm']);
  });
});

describe('RetryingEmbeddingProvider', () => {
  function flakyEmbedder(failures: number) {
    let calls = 0;
    const inner: EmbeddingProvider = {
      name: 'fake',
      model: 'm',
      dimensions: 3,
      async embed(texts) {
        calls += 1;
        if (calls <= failures) throw transient();
        return { vectors: texts.map(() => [1, 0, 0]), inputTokens: 5 };
      },
    };
    return { inner, calls: () => calls };
  }

  it('retries transient failures and returns the eventual result', async () => {
    const { policy: p, sleep } = policy();
    const { inner, calls } = flakyEmbedder(2);

    const result = await new RetryingEmbeddingProvider(inner, p).embed(['a', 'b'], 'document');

    expect(result.vectors).toHaveLength(2);
    expect(calls()).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('rethrows after exhausting attempts', async () => {
    const { policy: p } = policy({ maxAttempts: 2 });
    const { inner, calls } = flakyEmbedder(5);

    await expect(
      new RetryingEmbeddingProvider(inner, p).embed(['a'], 'query'),
    ).rejects.toBeInstanceOf(AiProviderError);
    expect(calls()).toBe(2);
  });

  it.each([
    ['a non-retryable provider error', new AiProviderError('bad key', { retryable: false })],
    ['an error that is not from the provider', new TypeError('bug')],
  ])('does not retry %s', async (_label, error) => {
    const { policy: p, sleep } = policy();
    const embed = vi.fn(async () => {
      throw error;
    });
    const inner: EmbeddingProvider = { name: 'f', model: 'm', dimensions: 3, embed };

    await expect(new RetryingEmbeddingProvider(inner, p).embed(['a'], 'query')).rejects.toBe(error);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('passes the texts, purpose and options (including the abort signal) through untouched', async () => {
    const { policy: p } = policy();
    const embed = vi.fn(async () => ({ vectors: [[1, 0, 0]], inputTokens: 1 }));
    const inner: EmbeddingProvider = { name: 'f', model: 'm', dimensions: 3, embed };
    const options = { title: 'Handbook', signal: new AbortController().signal };

    await new RetryingEmbeddingProvider(inner, p).embed(['a'], 'document', options);

    expect(embed).toHaveBeenCalledWith(['a'], 'document', options);
  });

  it('stops retrying once the caller has aborted, without sleeping', async () => {
    const { policy: p, sleep } = policy();
    const controller = new AbortController();
    const embed = vi.fn(async () => {
      controller.abort();
      throw transient();
    });
    const inner: EmbeddingProvider = { name: 'f', model: 'm', dimensions: 3, embed };

    await expect(
      new RetryingEmbeddingProvider(inner, p).embed(['a'], 'query', { signal: controller.signal }),
    ).rejects.toBeInstanceOf(AiProviderError);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('waits for the provider-supplied Retry-After, and fails fast when it is too long', async () => {
    const { policy: p, sleep } = policy({ maxDelayMs: 1_000 });
    const embed = vi
      .fn<EmbeddingProvider['embed']>()
      .mockRejectedValueOnce(transient(700))
      .mockResolvedValueOnce({ vectors: [[1, 0, 0]], inputTokens: 1 });
    const inner: EmbeddingProvider = { name: 'f', model: 'm', dimensions: 3, embed };

    await new RetryingEmbeddingProvider(inner, p).embed(['a'], 'query');
    expect(sleep).toHaveBeenCalledWith(700, undefined);

    const tooLong = vi.fn(async () => {
      throw transient(5_000);
    });
    await expect(
      new RetryingEmbeddingProvider({ ...inner, embed: tooLong }, p).embed(['a'], 'query'),
    ).rejects.toBeInstanceOf(AiProviderError);
    expect(tooLong).toHaveBeenCalledTimes(1);
  });

  it('exposes the wrapped provider identity', () => {
    const { inner } = flakyEmbedder(0);
    const wrapped = new RetryingEmbeddingProvider(inner);

    expect([wrapped.name, wrapped.model, wrapped.dimensions]).toEqual(['fake', 'm', 3]);
  });
});

describe('abortableSleep', () => {
  it('resolves after the delay and leaves no abort listener behind', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

      const sleeping = abortableSleep(250, controller.signal);
      await vi.advanceTimersByTimeAsync(250);

      await expect(sleeping).resolves.toBeUndefined();
      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects immediately with the abort reason when the signal was already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('already gone'));

    await expect(abortableSleep(10_000, controller.signal)).rejects.toThrow('already gone');
  });

  it('rejects as soon as the signal aborts, instead of waiting out the delay', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const sleeping = abortableSleep(60_000, controller.signal);
      const outcome = expect(sleeping).rejects.toThrow('stop now');

      controller.abort(new Error('stop now'));

      await outcome;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('works without a signal', async () => {
    vi.useFakeTimers();
    try {
      const sleeping = abortableSleep(5);
      await vi.advanceTimersByTimeAsync(5);

      await expect(sleeping).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
