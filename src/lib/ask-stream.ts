import { createParser } from 'eventsource-parser';

import { askEventSchema, type AskEvent } from '@/shared/contracts/stream-events';

import { ApiError, isAbortError, networkError, toApiError } from './api-client';

/** A reply is a few kilobytes; this only stops a broken or hostile server from filling memory. */
const MAX_BUFFERED_CHARS = 1_000_000;

const unexpected = () =>
  new ApiError(0, 'UNEXPECTED_RESPONSE', 'The server sent an unexpected response.');
const interrupted = () => new ApiError(0, 'NETWORK_ERROR', 'The connection was interrupted.');

async function open(documentId: string, question: string, signal?: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/documents/${encodeURIComponent(documentId)}/messages`, {
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
    maxBufferSize: MAX_BUFFERED_CHARS,
    onEvent: ({ data }) => {
      if (failure) return; // nothing after a malformed event can be trusted
      try {
        parsed.push(askEventSchema.parse(JSON.parse(data)));
      } catch {
        failure = unexpected();
      }
    },
    onError: () => {
      failure ??= unexpected();
    },
  });

  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        throw isAbortError(error) ? error : interrupted();
      }
      if (chunk.done) break;

      parser.feed(decoder.decode(chunk.value, { stream: true }));
      while (parsed.length > 0) yield parsed.shift()!;
      if (failure) throw failure;
    }
  } finally {
    // Also runs when the consumer stops early, which closes the connection.
    await reader.cancel().catch(() => undefined);
  }
}
