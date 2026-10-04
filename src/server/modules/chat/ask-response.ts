import { InternalError } from '@/server/core/errors';
import { problemDetailsResponse, toProblemDetails } from '@/server/core/http/problem';
import { sseResponse } from '@/server/core/http/sse';
import type { AskEvent } from '@/shared/contracts/stream-events';

export interface AskResponseOptions {
  readonly request: Request;
  readonly requestId: string;
  readonly events: AsyncGenerator<AskEvent>;
  /** Aborted on disconnect; the same signal was handed to the generator. */
  readonly controller: AbortController;
}

const wantsEventStream = (request: Request) =>
  (request.headers.get('accept') ?? '').toLowerCase().includes('text/event-stream');

/** Pulls the first event so a refusal is still a normal HTTP error, then streams SSE or returns plain JSON. */
export async function askResponse({
  request,
  requestId,
  events,
  controller,
}: AskResponseOptions): Promise<Response> {
  const first = await events.next();
  if (first.done) throw new InternalError(new Error('The ask stream ended without any event'));

  // An abort that happened while the checks ran never fires again: close the generator so it settles its reservation.
  if (request.signal.aborted) {
    controller.abort();
    await events.return(undefined);
    return new Response(null, { status: 499 });
  }

  const onClientGone = () => controller.abort();
  request.signal.addEventListener('abort', onClientGone, { once: true });

  if (wantsEventStream(request)) {
    return sseResponse(first.value, events, {
      controller,
      onUnexpectedError: (error): AskEvent => ({
        type: 'error',
        problem: toProblemDetails(new InternalError(error), {
          requestId,
          instance: new URL(request.url).pathname,
        }),
      }),
    });
  }

  try {
    let current: AskEvent = first.value;
    for (;;) {
      if (current.type === 'final') return Response.json({ message: current.message });
      if (current.type === 'error') return problemDetailsResponse(current.problem);
      const next = await events.next();
      if (next.done)
        throw new InternalError(new Error('The ask stream ended without a final event'));
      current = next.value;
    }
  } finally {
    request.signal.removeEventListener('abort', onClientGone);
  }
}
