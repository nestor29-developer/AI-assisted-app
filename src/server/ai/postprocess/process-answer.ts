import { sanitizeText } from '@/server/ai/guardrails/sanitize';
import { extractSourceMarkers } from '@/server/ai/prompts/document-qa/markers';
import type { FinishReason } from '@/server/ai/providers/types';
import { truncate } from '@/server/core/text';

import { parseAnswer } from './answer-parser';
import { resolveCitations } from './citations';
import { scoreConfidence } from './confidence';
import type { AnswerWarning, ProcessedAnswer, SourceRef } from './types';

export const DECLINED_MESSAGE =
  'The AI service declined to answer this question. Try rephrasing it.';
export const UNREADABLE_MESSAGE = "The AI's reply could not be read. Please try asking again.";

const MAX_ANSWER_CHARS = 4_000;
const MAX_FOLLOW_UP_CHARS = 200;
const MAX_FOLLOW_UPS = 3;

export interface ProcessAnswerInput {
  /** Everything the provider streamed, concatenated. */
  readonly raw: string;
  readonly finishReason: FinishReason;
  readonly sources: readonly SourceRef[];
  /** Answer text the user has already seen; kept when the final JSON turns out unreadable. */
  readonly streamedAnswer?: string;
}

const clean = (text: string) => sanitizeText(text).text.trim();

const clampAnswer = (text: string) =>
  text.length > MAX_ANSWER_CHARS ? `${truncate(text, MAX_ANSWER_CHARS).trimEnd()}…` : text;

function withoutAnswer(
  status: 'declined' | 'unreadable',
  answer: string,
  warnings: AnswerWarning[],
): ProcessedAnswer {
  return { status, answer, citations: [], followUpQuestions: [], confidence: 'none', warnings };
}

/** Raw model text in, validated and honestly scored answer out; bad output becomes a typed outcome. */
export function processAnswer(input: ProcessAnswerInput): ProcessedAnswer {
  const { raw, finishReason, sources } = input;

  if (finishReason === 'blocked') return withoutAnswer('declined', DECLINED_MESSAGE, []);

  const truncated = finishReason === 'length';
  const parsed = parseAnswer(raw);
  const answerText = parsed.ok ? clean(parsed.payload.answer) : '';

  if (!parsed.ok || answerText === '') {
    const salvaged = clampAnswer(clean(input.streamedAnswer ?? ''));
    const warnings: AnswerWarning[] = truncated
      ? ['MALFORMED_OUTPUT', 'TRUNCATED']
      : ['MALFORMED_OUTPUT'];
    return withoutAnswer('unreadable', salvaged || UNREADABLE_MESSAGE, warnings);
  }

  const { payload } = parsed;
  const warnings = new Set<AnswerWarning>();
  if (truncated) warnings.add('TRUNCATED');

  const answer = clampAnswer(answerText);
  if (answer !== answerText) warnings.add('TRUNCATED');

  if (payload.status === 'not_found') {
    return {
      status: 'not_found',
      answer,
      citations: [],
      followUpQuestions: [],
      confidence: 'none',
      warnings: [...warnings],
    };
  }

  const { citations, invalidReferences } = resolveCitations(payload.citations, sources);
  const knownIds = new Set(sources.map((source) => source.id));
  const citedIds = new Set(citations.map((citation) => citation.sourceId));
  const markers = extractSourceMarkers(answer);
  const unknownMarkers = markers.filter((id) => !knownIds.has(id));
  const uncitedMarkers = markers.filter((id) => knownIds.has(id) && !citedIds.has(id));

  if (invalidReferences.length > 0 || unknownMarkers.length > 0)
    warnings.add('INVALID_SOURCE_REFERENCE');
  if (citations.length === 0) warnings.add('NO_CITATIONS');
  else if (uncitedMarkers.length > 0) warnings.add('UNCITED_MARKER');
  if (citations.some((citation) => !citation.verified)) warnings.add('UNVERIFIED_CITATION');

  return {
    status: payload.status,
    answer,
    citations,
    followUpQuestions: payload.followUpQuestions
      .map((question) => truncate(clean(question), MAX_FOLLOW_UP_CHARS).trimEnd())
      .filter((question) => question.length > 0)
      .slice(0, MAX_FOLLOW_UPS),
    confidence: scoreConfidence(payload.status, citations, {
      unbackedClaims: warnings.has('INVALID_SOURCE_REFERENCE') || warnings.has('UNCITED_MARKER'),
    }),
    warnings: [...warnings],
  };
}
