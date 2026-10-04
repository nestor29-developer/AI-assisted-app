'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ButtonLink } from '@/components/ui/button-link';
import { EmptyState } from '@/components/ui/empty-state';
import { LiveStatus } from '@/components/ui/live-status';
import { Skeleton } from '@/components/ui/skeleton';
import { useAskStream } from '@/hooks/use-ask-stream';
import { useDocument, useMessages, useRateMessage } from '@/hooks/use-documents';
import { ApiError } from '@/lib/api-client';
import { describeError } from '@/lib/api-errors';
import { isBusy } from '@/lib/ask-state';
import { describeKind, formatBytes, formatExpiry } from '@/lib/format';
import { queryKeys } from '@/lib/query-keys';
import type { MessageDto } from '@/shared/contracts/messages';

import type { AnswerActions } from './answer-card';
import { AssistantMessage, StoppedReply } from './assistant-message';
import { Composer } from './composer';
import { describeReply } from './describe-reply';
import { STARTER_QUESTIONS } from './starter-questions';
import { STAGE_LABELS, StreamingReply } from './streaming-reply';
import { SuggestionChip } from './suggestion-chip';
import { useStickyComposer } from './use-sticky-composer';

const NO_MESSAGES: readonly MessageDto[] = [];

function UserBubble({ content }: { readonly content: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2 text-sm wrap-break-word whitespace-pre-wrap text-white">
        {content}
      </p>
    </div>
  );
}

/** The question a reply answers: the nearest user message before it. */
function askedBefore(messages: readonly MessageDto[], index: number): MessageDto | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = messages[i];
    if (candidate?.role === 'user') return candidate;
  }
  return null;
}

function ThreadSkeleton() {
  return (
    <div role="status" aria-label="Loading the conversation" className="space-y-3">
      <span className="sr-only">Loading the conversation…</span>
      <Skeleton className="ml-auto h-9 w-1/2" />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

function DocumentNotFound() {
  return (
    <EmptyState
      titleAs="h1"
      title="Document not found"
      description="It may have been deleted, or it has expired and was removed automatically."
    >
      <ButtonLink href="/documents">Back to your documents</ButtonLink>
    </EmptyState>
  );
}

export function ChatView({ documentId }: { readonly documentId: string }) {
  const queryClient = useQueryClient();
  const documentQuery = useDocument(documentId);
  const messagesQuery = useMessages(documentId);
  const { mutate: rateMessage, isError: rateFailed } = useRateMessage(documentId);
  const { state, ask, stop, dismiss } = useAskStream(documentId);
  const [draft, setDraft] = useState('');
  const [outcome, setOutcome] = useState('');
  // The server stores a pressed Stop and a dropped connection alike; only this session knows which it was.
  const [stoppedQuestions, setStoppedQuestions] = useState<ReadonlySet<string>>(() => new Set());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { composerRef, endRef, pin, followEnd } = useStickyComposer();

  const busy = isBusy(state.phase);
  const messages = messagesQuery.data ?? NO_MESSAGES;

  useEffect(() => {
    followEnd();
  }, [followEnd, messages.length, state.phase, state.text.length]);

  const focusComposer = useCallback(() => {
    // On a touch screen the keyboard would rise over the answer, and no focus ring is lost there.
    if (window.matchMedia?.('(pointer: coarse)')?.matches) return;
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const readThread = useCallback(
    () => queryClient.getQueryData<MessageDto[]>(queryKeys.messages(documentId)) ?? [],
    [queryClient, documentId],
  );

  const askDirect = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (!trimmed) return;
      const known = new Set(readThread().map((message) => message.id));
      pin();
      setOutcome('');
      focusComposer();
      void ask(trimmed).then(() => {
        const reply = readThread().findLast(
          (message) => message.role === 'assistant' && !known.has(message.id),
        );
        if (reply) setOutcome(describeReply(reply));
      });
    },
    [ask, focusComposer, pin, readThread],
  );

  const edit = useCallback((question: string) => {
    setDraft(question);
    inputRef.current?.focus();
  }, []);

  const onRate = useCallback(
    (messageId: string, value: 'up' | 'down') => rateMessage({ messageId, value }),
    [rateMessage],
  );

  // Stable between streamed words, so the stored answers above do not render again for each one.
  const actions: AnswerActions = useMemo(
    () => ({ busy, onAsk: askDirect, onEdit: edit, onRate }),
    [busy, askDirect, edit, onRate],
  );

  if (documentQuery.error instanceof ApiError && documentQuery.error.status === 404) {
    return <DocumentNotFound />;
  }

  function askFromComposer() {
    const question = draft;
    setDraft('');
    askDirect(question);
  }

  function stopAnswer() {
    const accepted = state.userMessage;
    if (accepted) {
      setStoppedQuestions((previous) => new Set(previous).add(accepted.id));
    } else {
      // Stopped before the server took the question: give it back to be sent again.
      setDraft((current) => (current === '' ? state.question : current));
    }
    stop();
    focusComposer();
  }

  function dismissFailure() {
    dismiss();
    focusComposer();
  }

  const showsPendingQuestion =
    (busy || state.phase === 'error') && state.userMessage === null && state.question !== '';
  const statusText = isBusy(state.phase) ? STAGE_LABELS[state.phase] : outcome;

  return (
    <div className="flex min-h-[calc(100dvh-7.5rem)] flex-col gap-6">
      <LiveStatus message={statusText} />

      <header className="space-y-1">
        <Link href="/documents" className="text-sm text-indigo-700 hover:underline">
          <span aria-hidden="true">←</span> All documents
        </Link>
        {documentQuery.isPending ? <Skeleton className="h-7 w-2/3" /> : null}
        {documentQuery.isError ? (
          <Alert tone="error">{describeError(documentQuery.error)}</Alert>
        ) : null}
        {documentQuery.isSuccess ? (
          <>
            <h1 className="text-xl font-semibold wrap-break-word text-slate-900">
              {documentQuery.data.title}
            </h1>
            <p className="text-xs text-slate-600">
              {describeKind(documentQuery.data)} · {formatBytes(documentQuery.data.sizeBytes)} ·{' '}
              {formatExpiry(documentQuery.data.expiresAt)}
            </p>
          </>
        ) : null}
      </header>

      <div className="flex-1 space-y-6">
        {messagesQuery.isPending ? <ThreadSkeleton /> : null}
        {messagesQuery.isError ? (
          <div className="space-y-3">
            <Alert tone="error">{describeError(messagesQuery.error)}</Alert>
            <Button variant="secondary" onClick={() => void messagesQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : null}

        {messagesQuery.isSuccess && messages.length === 0 && !busy && !showsPendingQuestion ? (
          <EmptyState
            title="Ask your first question"
            description="Answers come with quotes from the document, so you can check them."
          >
            {STARTER_QUESTIONS.map((question) => (
              <SuggestionChip key={question} question={question} onAsk={askDirect} />
            ))}
          </EmptyState>
        ) : null}

        {/* Mounted once the history is here, and silent: the status above announces each new answer once. */}
        {messagesQuery.isSuccess ? (
          <div role="log" aria-live="off" aria-label="Conversation" className="space-y-4">
            {messages.map((message, index) => {
              if (message.role === 'user')
                return <UserBubble key={message.id} content={message.content} />;
              const asked = askedBefore(messages, index);
              return (
                <AssistantMessage
                  key={message.id}
                  message={message}
                  question={asked?.content ?? null}
                  actions={actions}
                  stoppedByUser={asked !== null && stoppedQuestions.has(asked.id)}
                />
              );
            })}
          </div>
        ) : null}

        {showsPendingQuestion ? <UserBubble content={state.question} /> : null}
        {busy ? <StreamingReply phase={state.phase} text={state.text} /> : null}
        {state.phase === 'cancelled' && state.userMessage ? (
          <StoppedReply partial={state.text} question={state.question} actions={actions} byUser />
        ) : null}
        <div ref={endRef} />
      </div>

      <div
        ref={composerRef}
        className="sticky bottom-0 space-y-3 border-t border-slate-200 bg-slate-50/95 py-3 backdrop-blur [@media(max-height:32rem)]:static"
      >
        {state.phase === 'error' && state.failure ? (
          <div className="space-y-2">
            <Alert tone="error">{state.failure.message}</Alert>
            <div className="flex gap-2">
              {state.failure.code === 'UNAUTHENTICATED' ? (
                <ButtonLink href="/login" size="sm">
                  Sign in again
                </ButtonLink>
              ) : (
                <Button size="sm" onClick={() => askDirect(state.question)}>
                  Try again
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={dismissFailure}>
                Dismiss
              </Button>
            </div>
          </div>
        ) : null}
        {rateFailed ? (
          <Alert tone="error">Your feedback could not be saved. Please try again.</Alert>
        ) : null}
        <Composer
          value={draft}
          onChange={setDraft}
          onSubmit={askFromComposer}
          onStop={stopAnswer}
          busy={busy}
          disabled={!messagesQuery.isSuccess}
          inputRef={inputRef}
        />
      </div>
    </div>
  );
}
