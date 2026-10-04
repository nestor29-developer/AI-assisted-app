import type { BusyPhase } from '@/lib/ask-state';

import { AnswerText } from './answer-text';

export const STAGE_LABELS: Record<BusyPhase, string> = {
  sending: 'Sending your question…',
  retrieving: 'Searching your document…',
  generating: 'Thinking…',
  streaming: 'Writing the answer…',
};

/** The answer while it is being written. It is silent: the chat's status region announces each stage once. */
export function StreamingReply({
  phase,
  text,
}: {
  readonly phase: BusyPhase;
  readonly text: string;
}) {
  return (
    <div aria-hidden="true" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-sm text-slate-700">
        <span className="size-4 rounded-full border-2 border-indigo-200 border-t-indigo-600 motion-safe:animate-spin" />
        {STAGE_LABELS[phase]}
      </div>
      {text ? <AnswerText text={text} cursor /> : null}
    </div>
  );
}
