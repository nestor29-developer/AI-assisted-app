import { Badge, type BadgeTone } from '@/components/ui/badge';
import type { AssistantAnswer } from '@/shared/contracts/messages';

interface Presentation {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly hint: string;
}

type Verdict = Pick<AssistantAnswer, 'status' | 'confidence'>;
type Checked = Verdict & Pick<AssistantAnswer, 'citations'>;

const PARTIAL = {
  label: 'Partial answer',
  hint: 'The document answers only part of the question.',
} as const;

/** What the badge says is decided by the checks we ran, never by how sure the model sounded. */
export function describeConfidence({ status, confidence }: Verdict): Presentation {
  if (status === 'not_found') {
    return {
      label: 'No answer found',
      tone: 'neutral',
      hint: 'The document does not seem to answer this question.',
    };
  }
  if (status === 'declined') {
    return {
      label: 'Declined',
      tone: 'warning',
      hint: 'The AI service declined to answer this question.',
    };
  }
  if (status === 'unreadable') {
    return {
      label: 'Reply could not be read',
      tone: 'danger',
      hint: 'The AI reply was not in a form we could check.',
    };
  }
  if (confidence === 'high') {
    return {
      label: 'Quotes verified',
      tone: 'success',
      hint: 'Every quote was found in the excerpt it cites. That shows the quotes are real, not that the answer is right.',
    };
  }
  if (confidence === 'medium') {
    return {
      label: 'Partly verified',
      tone: 'warning',
      hint: 'Some of what the answer relies on could not be checked.',
    };
  }
  return {
    label: 'Unverified, double-check',
    tone: 'danger',
    hint: 'No quote could be matched to the excerpt it cites.',
  };
}

/** A partial answer whose quotes all check out is capped at medium; a second verdict would only contradict it. */
function isFullyQuotedPartial({ status, citations }: Checked): boolean {
  return (
    status === 'partially_answered' &&
    citations.length > 0 &&
    citations.every((citation) => citation.verified)
  );
}

/** The labels shown on a card, in order, so a new answer can be announced with the same words. */
export function describeBadges(answer: Checked): string[] {
  return [
    ...(isFullyQuotedPartial(answer) ? [] : [describeConfidence(answer).label]),
    ...(answer.status === 'partially_answered' ? [PARTIAL.label] : []),
  ];
}

export function ConfidenceBadge({ status, confidence }: Verdict) {
  const { label, tone, hint } = describeConfidence({ status, confidence });
  return (
    <Badge tone={tone} title={hint}>
      {label}
      <span className="sr-only">. {hint}</span>
    </Badge>
  );
}

export function AnswerBadges({ answer }: { readonly answer: Checked }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {isFullyQuotedPartial(answer) ? null : (
        <ConfidenceBadge status={answer.status} confidence={answer.confidence} />
      )}
      {answer.status === 'partially_answered' ? (
        <Badge tone="warning" title={PARTIAL.hint}>
          {PARTIAL.label}
        </Badge>
      ) : null}
    </div>
  );
}
