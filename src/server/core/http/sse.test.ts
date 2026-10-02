import { describe, expect, it, vi } from 'vitest';

import { formatSseEvent, sseResponse, type SseEvent } from './sse';

interface TestEvent extends SseEvent {
  readonly n?: number;
  readonly text?: string;
}

async function* source(events: TestEvent[], delayMs = 0): AsyncGenerator<TestEvent> {
  for (const event of events) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    yield event;
  }
}

async function readAll(response: Response): Promise<string> {
  return await response.text();
}

const open = (
  events: TestEvent[],
  extra: Partial<Parameters<typeof sseResponse<TestEvent>>[2]> = {},
  delayMs = 0,
) => {
  const iterator = source(events, delayMs);
  return {
    iterator,
    controller: new AbortController(),
    build(first: TestEvent, controller = new AbortController()) {
      return sseResponse(first, iterator, {
        controller,
        onUnexpectedError: () => ({ type: 'error', text: 'boom' }),
        ...extra,
      });
    },
  };
};

describe('formatSseEvent', () => {
  it('writes the event name and one line of JSON, even when the data contains newlines', () => {
    const frame = formatSseEvent({ type: 'delta', text: 'line one\nline two' } as TestEvent);

    expect(frame).toBe('event: delta\ndata: {"type":"delta","text":"line one\\nline two"}\n\n');
    expect(frame.split('\n').filter((line) => line.startsWith('data:'))).toHaveLength(1);
  });
});

describe('sseResponse', () => {
  it('sends the headers a streaming proxy and browser need', () => {
    const response = open([]).build({ type: 'accepted' });

    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
  });

  it('emits the already-pulled first event, then the rest in order, then closes', async () => {
    const { build } = open([{ type: 'delta', n: 1 }, { type: 'delta', n: 2 }, { type: 'final' }]);

    const body = await readAll(build({ type: 'accepted' }));

    const names = [...body.matchAll(/^event: (.+)$/gm)].map((match) => match[1]);
    expect(names).toEqual(['accepted', 'delta', 'delta', 'final']);
  });

  it('keeps a quiet connection alive with comment heartbeats', async () => {
    const { build } = open([{ type: 'final' }], { heartbeatMs: 10 }, 60);

    const body = await readAll(build({ type: 'accepted' }));

    expect(body).toContain(': ping\n\n');
    expect(body.endsWith('event: final\ndata: {"type":"final"}\n\n')).toBe(true);
  });

  it('stops the source and aborts upstream work when the client goes away', async () => {
    const { build, iterator } = open([{ type: 'delta' }, { type: 'delta' }], {}, 5);
    const returned = vi.spyOn(iterator, 'return');
    const controller = new AbortController();
    const reader = build({ type: 'accepted' }, controller).body!.getReader();

    await reader.read(); // the first event
    await reader.cancel();

    expect(controller.signal.aborted).toBe(true);
    expect(returned).toHaveBeenCalled();
  });

  it('turns an unexpected failure of the source into a closing error event', async () => {
    async function* failing(): AsyncGenerator<TestEvent> {
      yield { type: 'delta' };
      throw new Error('generator exploded');
    }
    const response = sseResponse<TestEvent>({ type: 'accepted' }, failing(), {
      controller: new AbortController(),
      onUnexpectedError: () => ({ type: 'error', text: 'safe message' }),
    });

    const body = await readAll(response);

    expect(body).toContain('event: error');
    expect(body).toContain('safe message');
    expect(body).not.toContain('generator exploded');
  });
});
