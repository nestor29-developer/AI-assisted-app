import type { AnswerStatus } from '@/server/ai/prompts/document-qa/output-schema';

export type Confidence = 'high' | 'medium' | 'low' | 'none';

export type AnswerWarning =
  | 'NO_CITATIONS'
  | 'UNVERIFIED_CITATION'
  | 'INVALID_SOURCE_REFERENCE'
  | 'TRUNCATED'
  | 'MALFORMED_OUTPUT';

/** The model's three statuses, plus the two outcomes where there is no usable model answer. */
export type AnswerOutcome = AnswerStatus | 'declined' | 'unreadable';

export interface SourceRef {
  readonly id: string;
  readonly chunkId: string;
  readonly page: number | null;
  readonly text: string;
}

export interface ResolvedCitation {
  readonly sourceId: string;
  readonly chunkId: string;
  readonly page: number | null;
  readonly quote: string;
  /** True when the quote really appears in the cited source (after whitespace/case/punctuation). */
  readonly verified: boolean;
}

export interface ProcessedAnswer {
  readonly status: AnswerOutcome;
  readonly answer: string;
  readonly citations: readonly ResolvedCitation[];
  readonly followUpQuestions: readonly string[];
  readonly confidence: Confidence;
  readonly warnings: readonly AnswerWarning[];
}
