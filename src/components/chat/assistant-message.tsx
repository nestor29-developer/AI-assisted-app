import { Button } from '@/components/ui/button';
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

/** An answer the user stopped: what was written so far, and a way to ask again. */
export function StoppedReply({
  partial,
  question,
  actions,
}: {
  readonly partial: string;
  readonly question: string | null;
  readonly actions: AnswerActions;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-medium text-slate-900">You stopped this answer</p>
      {partial ? (
        <p className="text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-slate-600">
          {partial}
        </p>
      ) : null}
      <ReplyActions question={question} actions={actions} label="Ask again" />
    </div>
  );
}

/** One stored reply: a checked answer, an error that was kept, or an answer the user stopped. */
export function AssistantMessage({
  message,
  question,
  actions,
}: {
  readonly message: MessageDto;
  readonly question: string | null;
  readonly actions: AnswerActions;
}) {
  if (message.status === 'failed') {
    return (
      <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-medium text-red-900">Could not get an answer</p>
        <p className="text-sm text-red-800">{describeFailedReply(message.errorCode)}</p>
        <ReplyActions question={question} actions={actions} label="Try again" />
      </div>
    );
  }

  if (message.status === 'cancelled') {
    return <StoppedReply partial={message.content} question={question} actions={actions} />;
  }

  if (message.answer) {
    return (
      <AnswerCard message={message} answer={message.answer} question={question} actions={actions} />
    );
  }
  return (
    <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-slate-800">
      {message.content}
    </p>
  );
}
