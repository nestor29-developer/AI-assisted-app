import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { queryKeys } from '@/lib/query-keys';
import type { MessageDto } from '@/shared/contracts/messages';
import { makeAssistantMessage, makeUserMessage } from '@/test/fixtures/messages';
import { json, stubApi } from '@/test/helpers/api';
import { controlledSse, sseResponse } from '@/test/helpers/sse';

import { useAskStream } from './use-ask-stream';
import { useMessages } from './use-documents';

const DOC = '00000000-0000-4000-8000-0000000000aa';
const THREAD = `GET /api/v1/documents/${DOC}/messages`;
const ASK = `POST /api/v1/documents/${DOC}/messages`;
const KEY = queryKeys.messages(DOC);

type Routes = Parameters<typeof stubApi>[0];

/** The hook is always used next to the thread query, which is what a refetch needs to find. */
function setup(routes: Routes, thread: MessageDto[] | null = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  if (thread) client.setQueryData(KEY, thread);
  const api = stubApi({ [THREAD]: () => json({ messages: thread ?? [] }), ...routes });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => ({ stream: useAskStream(DOC), thread: useMessages(DOC) }), {
    wrapper,
  });
  return { client, api, ...view };
}

const start = (ask: (question: string) => Promise<void>, question = 'A question') =>
  act(() => {
    void ask(question);
  });

describe('useAskStream: a stream that ends without an outcome', () => {
  it('ends in an error, not a spinner, and can be asked again', async () => {
    const accepted = { type: 'accepted', userMessage: makeUserMessage({ content: 'Q' }) } as const;
    const { result, api } = setup({ [ASK]: () => sseResponse([accepted]) });

    start(result.current.stream.ask);

    await waitFor(() => expect(result.current.stream.state.phase).toBe('error'));
    expect(result.current.stream.state.failure).toMatchObject({ code: 'NETWORK_ERROR' });

    start(result.current.stream.ask, 'Another');
    await waitFor(() => expect(api.callsTo(ASK)).toHaveLength(2));
  });

  it('does not treat an error event as a lost connection', async () => {
    const events = [
      { type: 'accepted', userMessage: makeUserMessage() },
      {
        type: 'error',
        problem: {
          type: 'urn:problem:ai_unavailable',
          title: 'Unavailable',
          status: 503,
          code: 'AI_UNAVAILABLE',
          detail: 'The model is down.',
        },
      },
    ] as const;
    const { result } = setup({ [ASK]: () => sseResponse([...events]) });

    start(result.current.stream.ask);

    await waitFor(() => expect(result.current.stream.state.phase).toBe('error'));
    expect(result.current.stream.state.failure).toMatchObject({ code: 'AI_UNAVAILABLE' });
  });
});

describe('useAskStream: keeping the stored thread in step', () => {
  it('is not undone by a refetch that was already in flight when the question was accepted', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let stream!: ReturnType<typeof controlledSse>;
    const userMessage = makeUserMessage({ content: 'Q' });
    const { result, client } = setup({
      [THREAD]: async () => {
        await gate;
        return json({ messages: [] });
      },
      [ASK]: (call) => {
        stream = controlledSse(call.signal);
        return stream.response;
      },
    });
    void client.invalidateQueries({ queryKey: KEY });

    start(result.current.stream.ask);
    await waitFor(() => expect(stream).toBeDefined());
    stream.push({ type: 'accepted', userMessage });
    await waitFor(() => expect(client.getQueryData<MessageDto[]>(KEY)).toContainEqual(userMessage));

    release();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(client.getQueryData<MessageDto[]>(KEY)).toContainEqual(userMessage);
    stream.push({ type: 'final', message: makeAssistantMessage() });
    stream.end();
  });

  it('reloads the thread, instead of dropping the message, when it was never loaded', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let stream!: ReturnType<typeof controlledSse>;
    let loads = 0;
    const userMessage = makeUserMessage({ content: 'Q' });
    const { result, client, api } = setup(
      {
        [THREAD]: async () => {
          loads += 1;
          if (loads === 1) await gate;
          return json({ messages: loads === 1 ? [] : [userMessage] });
        },
        [ASK]: (call) => {
          stream = controlledSse(call.signal);
          return stream.response;
        },
      },
      null,
    );
    expect(client.getQueryData(KEY)).toBeUndefined();

    start(result.current.stream.ask);
    await waitFor(() => expect(stream).toBeDefined());
    stream.push({ type: 'accepted', userMessage });

    await waitFor(() => expect(client.getQueryData<MessageDto[]>(KEY)).toContainEqual(userMessage));
    expect(api.callsTo(THREAD).length).toBeGreaterThanOrEqual(2);

    release();
    stream.push({ type: 'final', message: makeAssistantMessage() });
    stream.end();
  });
});

describe('useAskStream: stopping before the question was accepted', () => {
  it('clears the overlay and refreshes the thread, because the server may have stored it all', async () => {
    let stream!: ReturnType<typeof controlledSse>;
    const { result, api } = setup({
      [ASK]: (call) => {
        stream = controlledSse(call.signal);
        return stream.response;
      },
    });
    await waitFor(() => expect(api.callsTo(THREAD).length).toBeGreaterThanOrEqual(1));
    start(result.current.stream.ask);
    await waitFor(() => expect(api.callsTo(ASK)).toHaveLength(1));
    const loadsBefore = api.callsTo(THREAD).length;

    act(() => result.current.stream.stop());

    await waitFor(() => expect(result.current.stream.state.phase).toBe('idle'));
    await waitFor(() => expect(api.callsTo(THREAD).length).toBeGreaterThan(loadsBefore), {
      timeout: 3_000,
    });
  });
});
