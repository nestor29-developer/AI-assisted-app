import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeAssistantMessage, makeUserMessage } from '@/test/fixtures/messages';
import type { AskEvent } from '@/shared/contracts/stream-events';

import { ApiError } from './api-client';
import { streamAnswer } from './ask-stream';

const frame = (event: AskEvent) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
const encoder = new TextEncoder();

const userMessage = makeUserMessage();
const finalMessage = makeAssistantMessage();
const EVENTS: AskEvent[] = [
  { type: 'accepted', userMessage },
  { type: 'status', phase: 'retrieving' },
  { type: 'status', phase: 'generating' },
  { type: 'delta', text: 'Employees accrue 中文 \u{1F389} ' },
  { type: 'delta', text: 'days [S1].' },
  { type: 'final', message: finalMessage },
];

function streamOf(text: string, chunkBytes = Number.POSITIVE_INFINITY, onCancel?: () => void) {
  const bytes = encoder.encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      const end = Math.min(bytes.length, offset + chunkBytes);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
    cancel: onCancel,
  });
}

const sse = (body: ReadableStream<Uint8Array> | null) =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });

function stubFetch(result: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function collect(iterable: AsyncIterable<AskEvent>): Promise<AskEvent[]> {
  const events: AskEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

afterEach(() => vi.unstubAllGlobals());

describe('streamAnswer', () => {
  it('sends the question as JSON, asks for an event stream and yields typed events in order', async () => {
    const fetchMock = stubFetch(sse(streamOf(EVENTS.map(frame).join(''))));

    const events = await collect(streamAnswer('doc id/1', 'How many days?'));

    expect(events).toEqual(EVENTS);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/documents/doc%20id%2F1/messages',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: '{"question":"How many days?"}',
        headers: expect.objectContaining({ accept: 'text/event-stream' }),
      }),
    );
  });

  it.each([1, 2, 3, 7, 64])(
    'yields the same events when the bytes arrive %i at a time, even inside a multi-byte character',
    async (chunkBytes) => {
      stubFetch(sse(streamOf(EVENTS.map(frame).join(''), chunkBytes)));

      expect(await collect(streamAnswer('d', 'q'))).toEqual(EVENTS);
    },
  );

  it('ignores heartbeat comments between events', async () => {
    const text = `: ping\n\n${frame(EVENTS[0]!)}: ping\n\n: ping\n\n${frame(EVENTS[5]!)}`;
    stubFetch(sse(streamOf(text, 5)));

    expect(await collect(streamAnswer('d', 'q'))).toEqual([EVENTS[0], EVENTS[5]]);
  });

  it('throws the server refusal as an ApiError before any event', async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          type: 'urn:problem:rate-limited',
          title: 'Too many requests',
          status: 429,
          code: 'RATE_LIMITED',
          retryAfterSeconds: 20,
        }),
        { status: 429, headers: { 'content-type': 'application/problem+json' } },
      ),
    );

    const error = await collect(streamAnswer('d', 'q')).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 20 });
  });

  it.each([
    ['a success response that is not an event stream', new Response('{}', { status: 200 })],
    ['a stream response with no body', sse(null)],
  ])('rejects %s', async (_label, response) => {
    stubFetch(response);

    await expect(collect(streamAnswer('d', 'q'))).rejects.toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
    });
  });

  it('delivers the events before a malformed one, then fails loudly', async () => {
    const text = `${frame(EVENTS[0]!)}event: delta\ndata: {"type":"delta"}\n\n${frame(EVENTS[5]!)}`;
    stubFetch(sse(streamOf(text)));
    const received: AskEvent[] = [];

    const consume = async () => {
      for await (const event of streamAnswer('d', 'q')) received.push(event);
    };

    await expect(consume()).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
    expect(received).toEqual([EVENTS[0]]);
  });

  it('reports a failed connection as a network error and passes aborts through', async () => {
    stubFetch(new TypeError('fetch failed'));
    await expect(collect(streamAnswer('d', 'q'))).rejects.toMatchObject({ code: 'NETWORK_ERROR' });

    const abort = new DOMException('aborted', 'AbortError');
    stubFetch(abort);
    await expect(collect(streamAnswer('d', 'q'))).rejects.toBe(abort);
  });

  it('reports a connection that dies in the middle of the stream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frame(EVENTS[0]!)));
      },
      pull() {
        throw new TypeError('network error');
      },
    });
    stubFetch(sse(stream));
    const received: AskEvent[] = [];

    const consume = async () => {
      for await (const event of streamAnswer('d', 'q')) received.push(event);
    };

    await expect(consume()).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'The connection was interrupted.',
    });
    expect(received).toEqual([EVENTS[0]]);
  });

  it('simply ends when the stream closes without a final event, leaving the judgement to the caller', async () => {
    stubFetch(sse(streamOf(EVENTS.slice(0, 4).map(frame).join(''))));

    expect(await collect(streamAnswer('d', 'q'))).toEqual(EVENTS.slice(0, 4));
  });

  it('closes the connection when the consumer stops early', async () => {
    const onCancel = vi.fn();
    stubFetch(sse(streamOf(EVENTS.map(frame).join(''), 8, onCancel)));

    for await (const event of streamAnswer('d', 'q')) {
      void event;
      break;
    }

    expect(onCancel).toHaveBeenCalled();
  });

  it('surfaces an abort that happens while the stream is open', async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(encoder.encode(frame(EVENTS[0]!)));
        controller.signal.addEventListener('abort', () =>
          streamController.error(new DOMException('aborted', 'AbortError')),
        );
      },
    });
    stubFetch(sse(stream));

    const consume = async () => {
      for await (const event of streamAnswer('d', 'q', controller.signal)) {
        void event;
        controller.abort();
      }
    };

    await expect(consume()).rejects.toMatchObject({ name: 'AbortError' });
  });
});
