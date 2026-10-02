const encoder = new TextEncoder();
const DEFAULT_HEARTBEAT_MS = 15_000;

export interface SseEvent {
  readonly type: string;
}

export const formatSseEvent = (event: SseEvent): string =>
  `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

export interface SseOptions<T extends SseEvent> {
  /** Aborted when the client goes away, so upstream work (the model call) stops too. */
  readonly controller: AbortController;
  /** Builds the closing event if the source throws after the headers have already been sent. */
  readonly onUnexpectedError: (error: unknown) => T;
  readonly heartbeatMs?: number;
}

/** SSE response; `first` is pulled beforehand so refusals stay HTTP errors, and a heartbeat keeps proxies open. */
export function sseResponse<T extends SseEvent>(
  first: T,
  rest: AsyncIterator<T>,
  { controller, onUnexpectedError, heartbeatMs = DEFAULT_HEARTBEAT_MS }: SseOptions<T>,
): Response {
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stopHeartbeat = () => clearInterval(heartbeat);

  const stream = new ReadableStream<Uint8Array>({
    start(out) {
      out.enqueue(encoder.encode(formatSseEvent(first)));
      heartbeat = setInterval(() => {
        try {
          out.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          stopHeartbeat(); // the stream was closed or cancelled in the meantime
        }
      }, heartbeatMs);
    },
    async pull(out) {
      try {
        const next = await rest.next();
        if (next.done) {
          stopHeartbeat();
          out.close();
          return;
        }
        out.enqueue(encoder.encode(formatSseEvent(next.value)));
      } catch (error) {
        stopHeartbeat();
        out.enqueue(encoder.encode(formatSseEvent(onUnexpectedError(error))));
        out.close();
      }
    },
    async cancel() {
      stopHeartbeat();
      controller.abort();
      await rest.return?.(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      // no-transform stops compression middleware from buffering the stream into one blob.
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
