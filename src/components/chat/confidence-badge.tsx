import { Badge, type BadgeTone } from '@/components/ui/badge';
import type { AssistantAnswer } from '@/shared/contracts/messages';

interface Presentation {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly hint: string;
}

/** What the badge says is decided by the checks we ran, never by how sure the model sounded. */
export function describeConfidence({
  status,
  confidence,
}: Pick<AssistantAnswer, 'status' | 'confidence'>): Presentation {
  if (status === 'not_found') {
    return {
      label: 'Not found in the document',
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
      label: 'Grounded in the document',
      tone: 'success',
      hint: 'Every quote was found in the document.',
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
    hint: 'No quote could be checked against the document.',
  };
}

export function ConfidenceBadge({
  status,
  confidence,
}: Pick<AssistantAnswer, 'status' | 'confidence'>) {
  const { label, tone, hint } = describeConfidence({ status, confidence });
  return (
    <Badge tone={tone}>
      {label}
      <span className="sr-only">. {hint}</span>
    </Badge>
  );
}
