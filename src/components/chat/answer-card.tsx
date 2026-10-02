'use client';

import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDuration, formatTokens } from '@/lib/format';
import type { AssistantAnswer, MessageDto } from '@/shared/contracts/messages';
import { extractSourceMarkers } from '@/shared/source-markers';

import { AnswerText } from './answer-text';
import { ConfidenceBadge } from './confidence-badge';
import { FeedbackButtons } from './feedback-buttons';
import { SourceList } from './source-list';
import { SuggestionChip } from './suggestion-chip';

const WARNING_COPY: Record<AssistantAnswer['warnings'][number], string> = {
  NO_CITATIONS: 'The answer cites no sources, so it cannot be checked.',
  UNVERIFIED_CITATION: 'At least one quote could not be found in its source.',
  INVALID_SOURCE_REFERENCE: 'The answer refers to a source that was never provided.',
  UNCITED_MARKER: 'Part of the answer points to a source without quoting it.',
  TRUNCATED: 'The answer was cut short because it reached a length limit.',
  MALFORMED_OUTPUT: 'The reply was not in the expected format.',
};

export interface AnswerActions {
  readonly busy: boolean;
  readonly onAsk: (question: string) => void;
  readonly onEdit: (question: string) => void;
  readonly onRate: (messageId: string, value: 'up' | 'down') => void;
}

export function AnswerCard({
  message,
  answer,
  question,
  actions,
}: {
  readonly message: MessageDto;
  readonly answer: AssistantAnswer;
  /** The question this answers, so it can be asked again or edited. */
  readonly question: string | null;
  readonly actions: AnswerActions;
}) {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const markedIds = useMemo(() => extractSourceMarkers(answer.answer), [answer.answer]);
  const knownIds = useMemo(
    () => new Set(answer.sources.map((source) => source.id)),
    [answer.sources],
  );

  const setOpen = (id: string, open: boolean) =>
    setOpenIds((previous) => {
      const next = new Set(previous);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  const selectSource = (id: string) => {
    setOpen(id, true);
    document.getElementById(`source-${id}`)?.scrollIntoView({ block: 'nearest' });
  };

  const { meta } = answer;
  return (
    <article
      aria-label="Answer"
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceBadge status={answer.status} confidence={answer.confidence} />
        {answer.status === 'partially_answered' ? (
          <Badge tone="warning">Partial answer</Badge>
        ) : null}
      </div>

      <AnswerText text={answer.answer} markers={{ knownIds, openIds, onSelect: selectSource }} />

      {answer.warnings.length > 0 ? (
        <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {answer.warnings.map((warning) => (
            <li key={warning}>{WARNING_COPY[warning]}</li>
          ))}
        </ul>
      ) : null}

      <SourceList
        citations={answer.citations}
        sources={answer.sources}
        markedIds={markedIds}
        openIds={openIds}
        onToggle={setOpen}
      />

      {answer.followUpQuestions.length > 0 ? (
        <section aria-label="Follow-up questions" className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-900">You could also ask</h2>
          <div className="flex flex-wrap gap-2">
            {answer.followUpQuestions.map((followUp) => (
              <SuggestionChip
                key={followUp}
                question={followUp}
                disabled={actions.busy}
                onAsk={actions.onAsk}
              />
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {question ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={actions.busy}
              onClick={() => actions.onAsk(question)}
            >
              Ask again
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={actions.busy}
              onClick={() => actions.onEdit(question)}
            >
              Edit question
            </Button>
          </>
        ) : null}
        <FeedbackButtons
          value={message.feedback}
          onRate={(value) => actions.onRate(message.id, value)}
        />
      </div>

      <p className="text-xs text-slate-500">
        {meta.model} · prompt {meta.promptVersion} · {formatTokens(meta.inputTokens)} in /{' '}
        {formatTokens(meta.outputTokens)} out tokens · {formatDuration(meta.latencyMs)}
      </p>
    </article>
  );
}
