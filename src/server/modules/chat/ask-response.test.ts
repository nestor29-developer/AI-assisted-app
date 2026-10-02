import { describe, expect, it } from 'vitest';

import { NotFoundError, RateLimitedError } from '@/server/core/errors';
import { toProblemDetails } from '@/server/core/http/problem';
import type { MessageDto } from '@/shared/contracts/messages';
import type { AskEvent } from '@/shared/contracts/stream-events';

import { askResponse } from './ask-response';

const message: MessageDto = {
  id: crypto.randomUUID(),
  role: 'assistant',
  content: 'The answer.',
  answer: null,
  status: 'completed',
  errorCode: null,
  feedback: null,
  createdAt: '2026-10-01T12:00:00.000Z',
};

const accepted: AskEvent = { type: 'accepted', userMessage: { ...message, role: 'user' } };

async function* events(...list: AskEvent[]): AsyncGenerator<AskEvent> {
  for (const event of list) yield event;
}

const requestWith = (accept?: string, signal?: AbortSignal) =>
  new Request('http://localhost/api/v1/documents/x/messages', {
    method: 'POST',
    headers: accept ? { accept } : {},
    ...(signal ? { signal } : {}),
  });

function call(list: AsyncGenerator<AskEvent>, accept?: string, signal?: AbortSignal) {
  const controller = new AbortController();
  return {
    controller,
    promise: askResponse({
      request: requestWith(accept, signal),
      requestId: 'req-12345678',
      events: list,
      controller,
    }),
  };
}

describe('askResponse: streaming clients', () => {
  it('streams every event as SSE when the client asks for an event stream', async () => {
    const { promise } = call(
      events(
        accepted,
        { type: 'delta', text: 'The ' },
        { type: 'delta', text: 'answer.' },
        { type: 'final', message },
      ),
      'text/event-stream',
    );

    const response = await promise;
    const body = await response.text();

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect([...body.matchAll(/^event: (.+)$/gm)].map((m) => m[1])).toEqual([
      'accepted',
      'delta',
      'delta',
      'final',
    ]);
  });

  it('aborts upstream work when the client disconnects mid-stream', async () => {
    const clientGone = new AbortController();
    const { promise, controller } = call(
      events(accepted, { type: 'delta', text: 'x' }),
      'text/event-stream',
      clientGone.signal,
    );
    await promise;

    clientGone.abort();

    expect(controller.signal.aborted).toBe(true);
  });
});

describe('askResponse: plain JSON clients', () => {
  it('waits for the final message and returns it as JSON', async () => {
    const { promise } = call(
      events(
        accepted,
        { type: 'status', phase: 'generating' },
        { type: 'delta', text: 'x' },
        { type: 'final', message },
      ),
    );

    const response = await promise;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ message });
  });

  it('turns an in-stream error into a problem response with the right status and Retry-After', async () => {
    const problem = toProblemDetails(new RateLimitedError(12), {
      requestId: 'req-12345678',
      instance: '/x',
    });
    const { promise } = call(events(accepted, { type: 'error', problem }));

    const response = await promise;

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('12');
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.json()).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 12 });
  });
});

describe('askResponse: refusals', () => {
  it('lets a refusal thrown before the first event surface as a normal error (so the status stays right)', async () => {
    async function* refused(): AsyncGenerator<AskEvent> {
      throw new NotFoundError('Document');
    }

    await expect(call(refused(), 'text/event-stream').promise).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(call(refused()).promise).rejects.toBeInstanceOf(NotFoundError);
  });

  it('fails clearly if the source produces nothing at all', async () => {
    await expect(call(events()).promise).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});
