'use client';

import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { ApiError, isAbortError, networkError } from '@/lib/api-client';
import { askReducer, initialAskState, toFailure } from '@/lib/ask-state';
import { streamAnswer } from '@/lib/ask-stream';
import { queryKeys } from '@/lib/query-keys';
import type { MessageDto } from '@/shared/contracts/messages';

const LOST_CONNECTION = new ApiError(
  0,
  'NETWORK_ERROR',
  'The connection was interrupted before the answer finished.',
);

const STORED_REPLY_ATTEMPTS = 5;
const STORED_REPLY_DELAY_MS = 300;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** After a stop the server saves the reply once it notices the disconnect, so look a few times. */
async function waitForStoredReply(
  queryClient: QueryClient,
  documentId: string,
  userMessageId: string,
): Promise<boolean> {
  const key = queryKeys.messages(documentId);
  for (let attempt = 0; attempt < STORED_REPLY_ATTEMPTS; attempt += 1) {
    await queryClient.invalidateQueries({ queryKey: key });
    const messages = queryClient.getQueryData<MessageDto[]>(key) ?? [];
    const asked = messages.findIndex((message) => message.id === userMessageId);
    if (asked >= 0 && messages.slice(asked + 1).some((message) => message.role === 'assistant'))
      return true;
    await sleep(STORED_REPLY_DELAY_MS);
  }
  return false;
}

/** Runs one question at a time and keeps the stored thread in step; the state is only a live overlay. */
export function useAskStream(documentId: string) {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(askReducer, initialAskState);
  const running = useRef<AbortController | null>(null);
  const latestExchange = useRef(0);

  const addToThread = useCallback(
    async (message: MessageDto) => {
      const key = queryKeys.messages(documentId);
      // A refetch still in flight (the poll after a Stop) would otherwise land after this and wipe it.
      await queryClient.cancelQueries({ queryKey: key });
      if (queryClient.getQueryData(key) === undefined) {
        await queryClient.invalidateQueries({ queryKey: key });
        return;
      }
      queryClient.setQueryData<MessageDto[]>(key, (messages = []) => [
        ...messages.filter((existing) => existing.id !== message.id),
        message,
      ]);
    },
    [documentId, queryClient],
  );

  const ask = useCallback(
    async (question: string) => {
      if (running.current) return;
      const controller = new AbortController();
      running.current = controller;
      const exchange = ++latestExchange.current;
      dispatch({ type: 'start', question });

      let userMessageId: string | null = null;
      let completed = false;
      let finished = false;
      let stopped = false;
      try {
        for await (const event of streamAnswer(documentId, question, controller.signal)) {
          // The thread is updated first, so the state never describes a message the thread lacks.
          if (event.type === 'accepted') {
            userMessageId = event.userMessage.id;
            await addToThread(event.userMessage);
          } else if (event.type === 'final') {
            completed = true;
            await addToThread(event.message);
          }
          if (event.type === 'final' || event.type === 'error') finished = true;
          dispatch({ type: 'event', event });
        }
        // A stream that closes with neither outcome (a proxy timeout, a crash) must not leave "Writing..." up.
        if (!finished) throw LOST_CONNECTION;
      } catch (error) {
        if (isAbortError(error)) {
          stopped = true;
          dispatch({ type: 'cancelled' });
        } else {
          dispatch({
            type: 'failed',
            failure: toFailure(error instanceof ApiError ? error : networkError()),
          });
        }
      } finally {
        running.current = null;
      }

      // Another question may have started meanwhile; its overlay must not be cleared from here.
      const clearOverlay = () => {
        if (latestExchange.current === exchange) dispatch({ type: 'reset' });
      };
      if (completed) return clearOverlay();
      if (stopped && userMessageId === null) {
        clearOverlay();
        // The server may still have stored the question and a stopped reply after we gave up waiting.
        await sleep(STORED_REPLY_DELAY_MS);
        await queryClient.invalidateQueries({ queryKey: queryKeys.messages(documentId) });
        return;
      }
      // A refusal before anything was stored leaves no trace but its message, which stays on screen.
      if (userMessageId === null) return;
      // A failed or stopped reply is stored too. Until it shows up the overlay stands in for it.
      if (await waitForStoredReply(queryClient, documentId, userMessageId)) clearOverlay();
    },
    [addToThread, documentId, queryClient],
  );

  const stop = useCallback(() => running.current?.abort(), []);
  const dismiss = useCallback(() => dispatch({ type: 'reset' }), []);

  useEffect(() => () => running.current?.abort(), []);

  return { state, ask, stop, dismiss };
}
