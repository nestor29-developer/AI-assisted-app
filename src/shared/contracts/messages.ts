import { z } from 'zod';

export const QUESTION_MAX_CHARS = 2_000;

export const askRequestSchema = z.object({
  question: z.string().trim().min(1, 'Ask a question first.').max(QUESTION_MAX_CHARS),
});

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low', 'none'] as const;
export const ANSWER_OUTCOMES = [
  'answered',
  'partially_answered',
  'not_found',
  'declined',
  'unreadable',
] as const;
export const ANSWER_WARNINGS = [
  'NO_CITATIONS',
  'UNVERIFIED_CITATION',
  'INVALID_SOURCE_REFERENCE',
  'UNCITED_MARKER',
  'TRUNCATED',
  'MALFORMED_OUTPUT',
] as const;

export const citationSchema = z.object({
  sourceId: z.string(),
  page: z.number().int().positive().nullable(),
  quote: z.string(),
  /** True when the quote really appears in the cited source. */
  verified: z.boolean(),
});

/** The excerpt behind a [S#] marker, so the UI can show what the answer was based on. */
export const sourceExcerptSchema = z.object({
  id: z.string(),
  page: z.number().int().positive().nullable(),
  text: z.string(),
});

export const answerMetaSchema = z.object({
  model: z.string(),
  promptVersion: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
});

export const assistantAnswerSchema = z.object({
  status: z.enum(ANSWER_OUTCOMES),
  answer: z.string(),
  citations: z.array(citationSchema),
  followUpQuestions: z.array(z.string()),
  confidence: z.enum(CONFIDENCE_LEVELS),
  warnings: z.array(z.enum(ANSWER_WARNINGS)),
  sources: z.array(sourceExcerptSchema),
  meta: answerMetaSchema,
});

export const messageSchema = z.object({
  id: z.uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  /** Present on completed assistant messages only. */
  answer: assistantAnswerSchema.nullable(),
  status: z.enum(['completed', 'failed', 'cancelled']),
  errorCode: z.string().nullable(),
  feedback: z.enum(['up', 'down']).nullable(),
  createdAt: z.iso.datetime(),
});

export const messageListResponseSchema = z.object({ messages: z.array(messageSchema) });
export const messageResponseSchema = z.object({ message: messageSchema });

export const feedbackRequestSchema = z.object({
  value: z.enum(['up', 'down']),
  comment: z.string().trim().max(500).optional(),
});

export type AssistantAnswer = z.infer<typeof assistantAnswerSchema>;
export type MessageDto = z.infer<typeof messageSchema>;
export type FeedbackRequest = z.output<typeof feedbackRequestSchema>;
