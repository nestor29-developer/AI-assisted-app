import { sanitizeText } from '@/server/ai/guardrails/sanitize';
import { MAX_CITATIONS, type AnswerPayload } from '@/server/ai/prompts/document-qa/output-schema';
import { truncate } from '@/server/core/text';

import type { ResolvedCitation, SourceRef } from './types';

const MIN_QUOTE_TOKENS = 3;
const MIN_CONTENT_TOKENS = 2;
const MAX_QUOTE_CHARS = 400;
const CJK = /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu;
const CJK_TOKEN = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u;
// PDFs break "expense" into "ex-" and "pense" across two lines, and models tend to repair the word.
const HYPHEN_LINE_BREAK = /(\p{L})[-\u{2010}\u{2011}][ \t]{0,3}\n[ \t]{0,3}(?=\p{L})/gu;

/** Case, punctuation, width and whitespace are ignored; each CJK character counts as a word. */
export function matchTokens(text: string): string[] {
  return text
    .normalize('NFKC')
    .toUpperCase() // upper then lower folds "straße" with "STRASSE" and "kız" with "KIZ"
    .toLowerCase()
    .replace(/i\u{307}/gu, 'i')
    .replace(/['’ʼ]/g, '') // "can't" and "cant" are one word
    .replace(/(\d)[.,](?=\d{3}(?!\d))/g, '$1') // 1,000 and 1000 are one number
    .replace(CJK, ' $1 ')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
}

/** "of the company" is in every document and proves nothing; numbers and CJK characters count as content. */
const isContentToken = (token: string) =>
  token.length >= 4 || /\p{N}/u.test(token) || CJK_TOKEN.test(token);

function haystacks(sourceText: string): string[] {
  const variants = new Set([sourceText, sourceText.replace(HYPHEN_LINE_BREAK, '$1')]);
  return [...variants].map((text) => ` ${matchTokens(text).join(' ')} `);
}

/** True only when the whole quote appears in the source, word for word. A near miss is not a match. */
export function verifyQuote(quote: string, sourceText: string): boolean {
  const tokens = matchTokens(quote);
  if (tokens.length < MIN_QUOTE_TOKENS) return false;
  if (tokens.filter(isContentToken).length < MIN_CONTENT_TOKENS) return false;

  const needle = ` ${tokens.join(' ')} `;
  return haystacks(sourceText).some((haystack) => haystack.includes(needle));
}

/** Caps the displayed quote without ending on half a word, which could never match the source. */
function clipQuote(text: string): string {
  if (text.length <= MAX_QUOTE_CHARS) return text;
  const cut = truncate(text, MAX_QUOTE_CHARS);
  return /\s/u.test(text.charAt(cut.length)) ? cut : cut.replace(/\s\S*$/u, '');
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
    if (resolved.length >= MAX_CITATIONS) break;
    const source = byId.get(citation.sourceId);
    if (!source) {
      invalid.add(citation.sourceId);
      continue;
    }
    const quote = clipQuote(sanitizeText(citation.quote).text.trim());
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
