import type { AskEvent } from '@/shared/contracts/stream-events';

const encoder = new TextEncoder();
const frame = (event: AskEvent) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
const HEADERS = { 'content-type': 'text/event-stream; charset=utf-8' };

/** A complete answer stream, delivered at once. */
export function sseResponse(events: readonly AskEvent[]): Response {
  return new Response(events.map(frame).join(''), { status: 200, headers: HEADERS });
}

/** A stream the test feeds event by event, and that errors the way a real fetch does on abort. */
export function controlledSse(signal?: AbortSignal | null) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });
  signal?.addEventListener('abort', () => {
    try {
      controller.error(new DOMException('aborted', 'AbortError'));
    } catch {
      // The stream had already finished.
    }
  });
  return {
    response: new Response(stream, { status: 200, headers: HEADERS }),
    push: (event: AskEvent) => controller.enqueue(encoder.encode(frame(event))),
    end: () => controller.close(),
  };
}
