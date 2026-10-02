import { z } from 'zod';

export const ANSWER_STATUSES = ['answered', 'partially_answered', 'not_found'] as const;
export type AnswerStatus = (typeof ANSWER_STATUSES)[number];

/** Per-request schema: sourceId is an enum of the ids sent, so decoding cannot invent a source. */
export function buildAnswerSchema(sourceIds: readonly [string, ...string[]]) {
  // Key order is the generation order: the answer streams first, and the model classifies it last.
  return z.object({
    answer: z
      .string()
      .describe(
        'Plain-text answer. Put the source after each claim, like [S1]. Say what is missing if only partly answered.',
      ),
    citations: z
      .array(
        z.object({
          sourceId: z.enum(sourceIds).describe('Id of the source the quote was copied from.'),
          quote: z
            .string()
            .describe('ONE contiguous quote, at most 25 words, copied exactly from that source.'),
        }),
      )
      .max(8)
      .describe('One entry for each source id cited in the answer; at most 8.'),
    status: z
      .enum(ANSWER_STATUSES)
      .describe(
        'answered: every part supported. partially_answered: some part unsupported. not_found: nothing in the sources answers it.',
      ),
    followUpQuestions: z
      .array(z.string())
      .max(3)
      .describe('Up to 3 short questions the sources can answer; empty for not_found.'),
  });
}

/** Lenient on purpose: one bad citation id or a missing list must not discard a good answer. */
export const answerParseSchema = z.object({
  status: z.enum(ANSWER_STATUSES),
  answer: z.string(),
  citations: z.array(z.object({ sourceId: z.string(), quote: z.string() })).default([]),
  followUpQuestions: z.array(z.string()).default([]),
});

export type AnswerPayload = z.infer<typeof answerParseSchema>;

/** Plain JSON Schema for the provider; the `$schema` URL is not part of what Gemini accepts. */
export function toResponseJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema: Record<string, unknown> = { ...z.toJSONSchema(schema, { io: 'output' }) };
  delete jsonSchema.$schema;
  return jsonSchema;
}
