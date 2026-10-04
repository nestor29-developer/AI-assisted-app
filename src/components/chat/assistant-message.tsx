import { memo } from 'react';

import { Button } from '@/components/ui/button';
import { CARD_TITLE } from '@/components/ui/card-title';
import { describeFailedReply } from '@/lib/api-errors';
import type { MessageDto } from '@/shared/contracts/messages';

import { AnswerCard, type AnswerActions } from './answer-card';

function ReplyActions({
  question,
  actions,
  label,
}: {
  readonly question: string | null;
  readonly actions: AnswerActions;
  readonly label: string;
}) {
  if (!question) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={actions.busy}
      onClick={() => actions.onAsk(question)}
    >
      {label}
    </Button>
  );
}

/** An answer that ended early: what was written so far, marked unfinished, and a way to ask again. */
export function StoppedReply({
  partial,
  question,
  actions,
  byUser,
}: {
  readonly partial: string;
  readonly question: string | null;
  readonly actions: AnswerActions;
  /** The server stores a pressed Stop and a dropped connection alike, so only this session can claim it. */
  readonly byUser: boolean;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <p className={`${CARD_TITLE} text-slate-900`}>
        {byUser ? 'You stopped this answer' : 'This answer was cut short'}
      </p>
      {partial ? (
        <p className="max-w-[72ch] text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-slate-600 italic">
          {partial.trimEnd()}
          <span aria-hidden="true"> …</span>
        </p>
      ) : null}
      <ReplyActions question={question} actions={actions} label="Ask again" />
    </div>
  );
}

/** One stored reply: a checked answer, an error that was kept, or an answer that ended early. */
export const AssistantMessage = memo(function AssistantMessage({
  message,
  question,
  actions,
  stoppedByUser,
}: {
  readonly message: MessageDto;
  readonly question: string | null;
  readonly actions: AnswerActions;
  readonly stoppedByUser: boolean;
}) {
  if (message.status === 'failed') {
    return (
      <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
        <p className={`${CARD_TITLE} text-red-900`}>Could not get an answer</p>
        <p className="text-sm text-red-800">{describeFailedReply(message.errorCode)}</p>
        <ReplyActions question={question} actions={actions} label="Try again" />
      </div>
    );
  }

  if (message.status === 'cancelled') {
    return (
      <StoppedReply
        partial={message.content}
        question={question}
        actions={actions}
        byUser={stoppedByUser}
      />
    );
  }

  if (message.answer) {
    return (
      <AnswerCard message={message} answer={message.answer} question={question} actions={actions} />
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="max-w-[72ch] text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-slate-800">
        {message.content}
      </p>
    </div>
  );
});
