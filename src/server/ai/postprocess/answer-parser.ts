import {
  answerParseSchema,
  type AnswerPayload,
} from '@/server/ai/prompts/document-qa/output-schema';

export type ParseResult =
  | { readonly ok: true; readonly payload: AnswerPayload }
  | { readonly ok: false; readonly reason: 'empty' | 'invalid_json' | 'schema_mismatch' };

// JSON mode should not add fences, but a provider that does must not turn a good answer unreadable.
const CODE_FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

export function parseAnswer(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, reason: 'empty' };

  let json: unknown;
  try {
    json = JSON.parse(CODE_FENCE.exec(trimmed)?.[1] ?? trimmed);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  const parsed = answerParseSchema.safeParse(json);
  return parsed.success
    ? { ok: true, payload: parsed.data }
    : { ok: false, reason: 'schema_mismatch' };
}
