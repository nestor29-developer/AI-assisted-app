import type { AnswerPayload } from '@/server/ai/prompts/document-qa/output-schema';
import { sanitizeText } from '@/server/ai/guardrails/sanitize';

import type { ResolvedCitation, SourceRef } from './types';

const MIN_QUOTE_TOKENS = 3;
const MAX_QUOTE_TOKENS = 80;
const MAX_QUOTE_CHARS = 400;
const SHINGLE_SIZE = 3;
const SHINGLE_COVERAGE = 0.8;
const CJK = /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu;

/** Case, punctuation, width and whitespace are ignored; each CJK character counts as a word. */
export function matchTokens(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(CJK, ' $1 ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
}

function shingles(tokens: readonly string[]): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i + SHINGLE_SIZE <= tokens.length; i += 1) {
    result.add(tokens.slice(i, i + SHINGLE_SIZE).join(' '));
  }
  return result;
}

/** True if the quote is in the source, verbatim or with a few words changed; word order matters. */
export function verifyQuote(quote: string, sourceText: string): boolean {
  const quoteTokens = matchTokens(quote).slice(0, MAX_QUOTE_TOKENS);
  if (quoteTokens.length < MIN_QUOTE_TOKENS) return false;
  const sourceTokens = matchTokens(sourceText);

  const haystack = ` ${sourceTokens.join(' ')} `;
  if (haystack.includes(` ${quoteTokens.join(' ')} `)) return true;

  const wanted = shingles(quoteTokens);
  const available = shingles(sourceTokens);
  let found = 0;
  for (const shingle of wanted) if (available.has(shingle)) found += 1;
  return wanted.size > 0 && found / wanted.size >= SHINGLE_COVERAGE;
}

/** The ids the model wrote into its answer text, such as the S2 in "[S2]". */
export function extractMarkers(answer: string): string[] {
  return [...new Set([...answer.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]!))];
}

export interface ResolvedCitations {
  readonly citations: ResolvedCitation[];
  /** Source ids that were cited but were never sent to the model. */
  readonly invalidReferences: string[];
}

export function resolveCitations(
  citations: AnswerPayload['citations'],
  sources: readonly SourceRef[],
): ResolvedCitations {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const resolved: ResolvedCitation[] = [];
  const invalid = new Set<string>();
  const seen = new Set<string>();

  for (const citation of citations) {
    const source = byId.get(citation.sourceId);
    if (!source) {
      invalid.add(citation.sourceId);
      continue;
    }
    const quote = sanitizeText(citation.quote).text.trim().slice(0, MAX_QUOTE_CHARS);
    const key = `${source.id}|${matchTokens(quote).join(' ')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    resolved.push({
      sourceId: source.id,
      chunkId: source.chunkId,
      page: source.page,
      quote,
      verified: verifyQuote(quote, source.text),
    });
  }
  return { citations: resolved, invalidReferences: [...invalid] };
}
