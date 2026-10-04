'use client';

import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { CARD_TITLE } from '@/components/ui/card-title';
import { ellipsize, formatDuration, formatTokens } from '@/lib/format';
import type { AssistantAnswer, MessageDto } from '@/shared/contracts/messages';
import { extractSourceMarkers } from '@/shared/source-markers';

import { AnswerText } from './answer-text';
import { AnswerBadges } from './confidence-badge';
import { FeedbackButtons } from './feedback-buttons';
import { sourceRowId } from './source-ids';
import { SourceList } from './source-list';
import { STARTER_QUESTIONS } from './starter-questions';
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

/** Each datum stays on one line, so a narrow screen breaks between them and never inside one. */
function Meta({ data }: { readonly data: readonly string[] }) {
  return (
    <p className="text-xs text-slate-600">
      {data.map((datum, index) => (
        <Fragment key={`${index}-${datum}`}>
          {index > 0 ? ' · ' : null}
          <span className="whitespace-nowrap">{datum}</span>
        </Fragment>
      ))}
    </p>
  );
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
  const scope = useId();
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const reveal = useRef<string | null>(null);
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

  const toggleSource = (id: string) => {
    if (openIds.has(id)) {
      setOpen(id, false);
      return;
    }
    reveal.current = id;
    setOpen(id, true);
  };

  // Once a chip has opened its excerpt, show the excerpt and move focus there, off the chip.
  useEffect(() => {
    const id = reveal.current;
    if (id === null || !openIds.has(id)) return;
    reveal.current = null;
    const row = document.getElementById(sourceRowId(scope, id));
    row?.scrollIntoView({ block: 'nearest' });
    row?.querySelector('summary')?.focus({ preventScroll: true });
  }, [openIds, scope]);

  const { meta } = answer;
  const notFound = answer.status === 'not_found';
  const suggestions =
    notFound && answer.followUpQuestions.length === 0
      ? STARTER_QUESTIONS
      : answer.followUpQuestions;
  // The badge already says an unreadable reply was malformed.
  const warnings = answer.warnings.filter(
    (warning) => !(warning === 'MALFORMED_OUTPUT' && answer.status === 'unreadable'),
  );

  return (
    <article
      aria-label={question ? `Answer to: ${ellipsize(question, 80)}` : 'Answer'}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <AnswerBadges answer={answer} />

      <AnswerText
        text={answer.answer}
        markers={{ knownIds, openIds, scope, onToggle: toggleSource }}
      />

      {warnings.length > 0 ? (
        <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {warnings.map((warning, index) => (
            <li key={`${index}-${warning}`}>{WARNING_COPY[warning]}</li>
          ))}
        </ul>
      ) : null}

      <SourceList
        scope={scope}
        citations={answer.citations}
        sources={answer.sources}
        markedIds={markedIds}
        openIds={openIds}
        onOpenChange={setOpen}
      />

      {suggestions.length > 0 ? (
        <section className="space-y-2">
          <h2 className={`${CARD_TITLE} text-slate-900`}>You could also ask</h2>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion, index) => (
              <SuggestionChip
                key={`${index}-${suggestion}`}
                question={suggestion}
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
              {notFound ? 'Try rephrasing' : 'Edit question'}
            </Button>
          </>
        ) : null}
        <FeedbackButtons
          value={message.feedback}
          onRate={(value) => actions.onRate(message.id, value)}
        />
      </div>

      <Meta
        data={[
          meta.model,
          `prompt ${meta.promptVersion}`,
          `${formatTokens(meta.inputTokens)} in / ${formatTokens(meta.outputTokens)} out tokens`,
          formatDuration(meta.latencyMs),
        ]}
      />
    </article>
  );
}
