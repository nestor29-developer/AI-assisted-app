import type { BusyPhase } from '@/lib/ask-state';

import { AnswerText } from './answer-text';

const LABELS: Record<BusyPhase, string> = {
  sending: 'Sending your question…',
  retrieving: 'Searching your document…',
  generating: 'Thinking…',
  streaming: 'Writing the answer…',
};

/** The answer while it is being written. Screen readers hear the stage, not every word. */
export function StreamingReply({
  phase,
  text,
}: {
  readonly phase: BusyPhase;
  readonly text: string;
}) {
  return (
    <div aria-busy="true" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-sm text-slate-700" aria-hidden="true">
        <span className="size-4 rounded-full border-2 border-indigo-200 border-t-indigo-600 motion-safe:animate-spin" />
        {LABELS[phase]}
      </div>
      <p role="status" className="sr-only">
        {LABELS[phase]}
      </p>
      {text ? (
        <div aria-hidden="true">
          <AnswerText text={text} cursor />
        </div>
      ) : null}
    </div>
  );
}
