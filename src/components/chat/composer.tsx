'use client';

import { useEffect, useRef, type FormEvent, type KeyboardEvent, type RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { QUESTION_MAX_CHARS } from '@/shared/contracts/messages';

const MAX_HEIGHT_PX = 192;
const COUNTER_FROM = Math.floor(QUESTION_MAX_CHARS * 0.8);
/** The second click of a double-click on Ask lands where Stop now is; Stop ignores clicks this soon after it appears. */
export const STOP_ARMS_AFTER_MS = 300;

function StopButton({ onStop }: { readonly onStop: () => void }) {
  const shownAt = useRef<number | null>(null);
  useEffect(() => {
    shownAt.current = Date.now();
  }, []);

  function onClick() {
    if (shownAt.current === null || Date.now() - shownAt.current < STOP_ARMS_AFTER_MS) return;
    onStop();
  }

  return (
    <Button type="button" variant="secondary" className="min-w-16" onClick={onClick}>
      Stop
    </Button>
  );
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  disabled,
  inputRef,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onStop: () => void;
  /** A question is being answered: sending is off and Stop is on. */
  readonly busy: boolean;
  /** The thread has not loaded, so a new question cannot be shown yet. */
  readonly disabled: boolean;
  readonly inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const canSend = !busy && !disabled && value.trim().length > 0;

  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value, inputRef]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (canSend) onSubmit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Safari reports the Enter that confirms an IME composition as keyCode 229, after isComposing has cleared.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    if (event.keyCode === 229) return;
    event.preventDefault();
    submit();
  }

  return (
    <form onSubmit={submit} aria-label="Ask a question" className="space-y-1.5">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="question" className="sr-only">
            Your question
          </label>
          <textarea
            ref={inputRef}
            id="question"
            rows={2}
            value={value}
            maxLength={QUESTION_MAX_CHARS}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask a question about this document"
            aria-describedby="question-hint"
            className="block max-h-48 w-full resize-none rounded-lg border border-slate-500 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-indigo-600 disabled:bg-slate-100"
          />
        </div>
        {busy ? (
          <StopButton key="stop" onStop={onStop} />
        ) : (
          <Button key="ask" type="submit" className="min-w-16" disabled={!canSend}>
            Ask
          </Button>
        )}
      </div>
      <p id="question-hint" className="flex justify-between gap-3 text-xs text-slate-600">
        <span className="[@media(pointer:coarse)]:hidden">
          Enter to send, Shift+Enter for a new line.
        </span>
        {value.length >= COUNTER_FROM ? (
          <span>
            {value.length.toLocaleString('en-US')} / {QUESTION_MAX_CHARS.toLocaleString('en-US')}
          </span>
        ) : null}
      </p>
    </form>
  );
}
