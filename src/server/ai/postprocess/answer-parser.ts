import {
  answerParseSchema,
  type AnswerPayload,
} from '@/server/ai/prompts/document-qa/output-schema';

export type ParseResult =
  | { readonly ok: true; readonly payload: AnswerPayload }
  | { readonly ok: false; readonly reason: 'empty' | 'invalid_json' | 'schema_mismatch' };

/** The first balanced {...} in the text, skipping braces inside strings; a single linear pass. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** JSON mode should return bare JSON, but a fence or a sentence around it must not make a good answer unreadable. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not bare JSON: fall through and look for an object inside the text.
  }
  const candidate = extractJsonObject(text);
  if (candidate === null) return undefined;
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

export function parseAnswer(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, reason: 'empty' };

  const json = parseJson(trimmed);
  if (json === undefined) return { ok: false, reason: 'invalid_json' };

  const parsed = answerParseSchema.safeParse(json);
  return parsed.success
    ? { ok: true, payload: parsed.data }
    : { ok: false, reason: 'schema_mismatch' };
}
