import type { AnswerStatus } from '@/server/ai/prompts/document-qa/output-schema';

import type { Confidence } from './types';

/** From checkable facts, never the model's self-report: all quotes verified is high (medium if partial). */
export function scoreConfidence(
  status: AnswerStatus,
  citations: readonly { readonly verified: boolean }[],
): Confidence {
  if (status === 'not_found') return 'none';
  if (citations.length === 0) return 'low';

  const verified = citations.filter((citation) => citation.verified).length;
  if (verified === 0) return 'low';
  if (verified < citations.length) return 'medium';
  return status === 'partially_answered' ? 'medium' : 'high';
}
