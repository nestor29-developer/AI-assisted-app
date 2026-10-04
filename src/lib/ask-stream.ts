import { createParser } from 'eventsource-parser';

import { askEventSchema, type AskEvent } from '@/shared/contracts/stream-events';

import { ApiError, isAbortError, networkError, toApiError } from './api-client';
import { apiPaths } from './api-paths';

/** A whole reply is a few tens of kilobytes; this only stops a broken or hostile server filling memory. */
const MAX_STREAM_CHARS = 512 * 1024;

/** A newer server may send event types this client has never heard of; those are skipped, not fatal. */
const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set(
  askEventSchema.options.map((option) => option.shape.type.value),
);

const unexpected = (cause?: unknown) =>
  new ApiError(
    0,
    'UNEXPECTED_RESPONSE',
    'The server sent an unexpected response.',
    undefined,
    [],
    cause,
  );
const interrupted = () => new ApiError(0, 'NETWORK_ERROR', 'The connection was interrupted.');

async function open(documentId: string, question: string, signal?: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(apiPaths.messages(documentId), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw networkError();
  }
  // A refusal (404, 429, quota...) arrives as a normal HTTP error before any stream starts.
  if (!response.ok) throw await toApiError(response);
  const isStream = (response.headers.get('content-type') ?? '').includes('text/event-stream');
  if (!isStream || response.body === null) throw unexpected();
  return response;
}

/** Typed events for one answer. A refusal throws ApiError; a stream with no final event just ends. */
export async function* streamAnswer(
  documentId: string,
  question: string,
  signal?: AbortSignal,
): AsyncGenerator<AskEvent> {
  const response = await open(documentId, question, signal);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const parsed: AskEvent[] = [];
  let failure: ApiError | null = null;

  const parser = createParser({
    maxBufferSize: MAX_STREAM_CHARS,
    onEvent: ({ data }) => {
      if (failure || data === '') return; // nothing after a malformed event can be trusted
      let raw: unknown;
      try {
        raw = JSON.parse(data);
      } catch (cause) {
        failure = unexpected(cause);
        return;
      }
      const type =
        typeof raw === 'object' && raw !== null ? (raw as { type?: unknown }).type : null;
      if (typeof type !== 'string') {
        failure = unexpected();
        return;
      }
      if (!KNOWN_EVENT_TYPES.has(type)) return;

      const event = askEventSchema.safeParse(raw);
      if (event.success) parsed.push(event.data);
      // A progress hint we cannot read is not worth failing an answer for.
      else if (type !== 'status') failure = unexpected(event.error);
    },
    // Unknown fields and bad retry hints are harmless: they never carry an answer.
    onError: () => undefined,
  });

  let received = 0;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        throw isAbortError(error) ? error : interrupted();
      }
      if (chunk.done) break;

      const text = decoder.decode(chunk.value, { stream: true });
      received += text.length;
      if (received > MAX_STREAM_CHARS) throw unexpected();
      parser.feed(text);
      while (parsed.length > 0) yield parsed.shift()!;
      if (failure) throw failure;
    }
  } finally {
    // Also runs when the consumer stops early, which closes the connection.
    await reader.cancel().catch(() => undefined);
  }
}
