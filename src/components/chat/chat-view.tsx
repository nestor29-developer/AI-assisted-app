'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useAskStream } from '@/hooks/use-ask-stream';
import { useDocument, useMessages, useRateMessage } from '@/hooks/use-documents';
import { ApiError } from '@/lib/api-client';
import { describeError } from '@/lib/api-errors';
import { isBusy } from '@/lib/ask-state';
import { describeKind, formatBytes, formatExpiry } from '@/lib/format';
import type { MessageDto } from '@/shared/contracts/messages';

import type { AnswerActions } from './answer-card';
import { AssistantMessage, StoppedReply } from './assistant-message';
import { Composer } from './composer';
import { StreamingReply } from './streaming-reply';
import { SuggestionChip } from './suggestion-chip';

const STARTER_QUESTIONS = [
  'Summarize this document in a few sentences.',
  'What are the key dates or deadlines?',
  'What are the main points to remember?',
] as const;

/** Within this many pixels of the bottom, new text keeps the view pinned there. */
const STICK_TO_BOTTOM_PX = 160;

function UserBubble({ content }: { readonly content: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2 text-sm break-words whitespace-pre-wrap text-white">
        {content}
      </p>
    </div>
  );
}

/** The question a reply answers: the nearest user message before it. */
function questionBefore(messages: readonly MessageDto[], index: number): string | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = messages[i];
    if (candidate?.role === 'user') return candidate.content;
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
      <Link
        href="/documents"
        className="inline-flex h-10 items-center rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700"
      >
        Back to your documents
      </Link>
    </EmptyState>
  );
}

export function ChatView({ documentId }: { readonly documentId: string }) {
  const documentQuery = useDocument(documentId);
  const messagesQuery = useMessages(documentId);
  const rate = useRateMessage(documentId);
  const { state, ask, stop, dismiss } = useAskStream(documentId);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const busy = isBusy(state.phase);
  const messages = messagesQuery.data ?? [];

  useEffect(() => {
    const onScroll = () => {
      const distance =
        document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
      pinnedToBottom.current = distance <= STICK_TO_BOTTOM_PX;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (pinnedToBottom.current) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, state.phase, state.text.length]);

  if (documentQuery.error instanceof ApiError && documentQuery.error.status === 404) {
    return <DocumentNotFound />;
  }

  function askDirect(question: string) {
    const trimmed = question.trim();
    if (!trimmed) return;
    pinnedToBottom.current = true;
    void ask(trimmed);
  }

  function askFromComposer() {
    const question = draft;
    setDraft('');
    askDirect(question);
  }

  function edit(question: string) {
    setDraft(question);
    inputRef.current?.focus();
  }

  const actions: AnswerActions = {
    busy,
    onAsk: askDirect,
    onEdit: edit,
    onRate: (messageId, value) => rate.mutate({ messageId, value }),
  };

  const showsPendingQuestion =
    (busy || state.phase === 'error') && state.userMessage === null && state.question !== '';

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/documents" className="text-sm text-indigo-700 hover:underline">
          ← All documents
        </Link>
        {documentQuery.isPending ? <Skeleton className="h-7 w-2/3" /> : null}
        {documentQuery.isError ? (
          <Alert tone="error">{describeError(documentQuery.error)}</Alert>
        ) : null}
        {documentQuery.isSuccess ? (
          <>
            <h1 className="text-xl font-semibold break-words text-slate-900">
              {documentQuery.data.title}
            </h1>
            <p className="text-xs text-slate-600">
              {describeKind(documentQuery.data)} · {formatBytes(documentQuery.data.sizeBytes)} ·{' '}
              {formatExpiry(documentQuery.data.expiresAt)}
            </p>
          </>
        ) : null}
      </header>

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

      <div role="log" aria-label="Conversation" className="space-y-4">
        {messages.map((message, index) =>
          message.role === 'user' ? (
            <UserBubble key={message.id} content={message.content} />
          ) : (
            <AssistantMessage
              key={message.id}
              message={message}
              question={questionBefore(messages, index)}
              actions={actions}
            />
          ),
        )}
      </div>

      {showsPendingQuestion ? <UserBubble content={state.question} /> : null}
      {isBusy(state.phase) ? <StreamingReply phase={state.phase} text={state.text} /> : null}
      {state.phase === 'cancelled' && state.userMessage ? (
        <StoppedReply partial={state.text} question={state.question} actions={actions} />
      ) : null}
      <div ref={bottomRef} />

      <div className="sticky bottom-0 -mx-4 space-y-3 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur">
        {state.phase === 'error' && state.failure ? (
          <div className="space-y-2">
            <Alert tone="error">{state.failure.message}</Alert>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => askDirect(state.question)}>
                Try again
              </Button>
              <Button size="sm" variant="secondary" onClick={dismiss}>
                Dismiss
              </Button>
            </div>
          </div>
        ) : null}
        {rate.isError ? (
          <Alert tone="error">Your feedback could not be saved. Please try again.</Alert>
        ) : null}
        <Composer
          value={draft}
          onChange={setDraft}
          onSubmit={askFromComposer}
          onStop={stop}
          busy={busy}
          disabled={!messagesQuery.isSuccess}
          inputRef={inputRef}
        />
      </div>
    </div>
  );
}
