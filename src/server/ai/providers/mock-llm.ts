import type { AnswerPayload } from '@/server/ai/prompts/document-qa/output-schema';
import { estimateTokens } from '@/server/ai/tokens';
import { splitAtWidth } from '@/server/core/text';

import { AiProviderError } from './errors';
import { abortableSleep } from './retry';
import { significantTokens, splitSentences } from './mock-text';
import type { Grounding, LlmEvent, LlmProvider, LlmRequest } from './types';

const MAX_QUOTE_WORDS = 25;
const STRONG_MATCH_RATIO = 0.5;
/** A request for the gist is answered from the opening, unless it also names something in the text. */
const SUMMARY_REQUEST = /summar|main points|key points|overview|what is this (document )?about/i;
/** Words that only shape such a request; a planted note saying "this document" must not win on them. */
const REQUEST_WORDS = new Set(
  significantTokens(
    'summarize summarise summary document text few brief short sentences main key points overview about give',
  ),
);
const SUMMARY_SENTENCES = 3;
const SENTENCE_END = /[.!?。！？]["')\]]?$/u;
const SUMMARY_FOLLOW_UPS = ['Which dates or deadlines does it mention?'];

const firstWords = (text: string) => text.split(/\s+/).slice(0, MAX_QUOTE_WORDS).join(' ');

/** The first two or three sentences of the first source, with a quote taken whole from one of them. */
function summarize(sources: Grounding['sources']): AnswerPayload | null {
  const first = sources[0];
  if (!first) return null;
  const sentences = splitSentences(first.text);
  // A heading has no end mark and makes a poor opening, so it is skipped.
  const prose = sentences.filter((sentence) => SENTENCE_END.test(sentence));
  const lead = (prose.length > 0 ? prose : sentences).slice(0, SUMMARY_SENTENCES);
  const quoted = lead.find((sentence) => sentence.split(/\s+/).length >= 4) ?? lead[0];
  if (!quoted) return null;
  return {
    answer: `${lead.join(' ')} [${first.id}]`,
    citations: [{ sourceId: first.id, quote: firstWords(quoted) }],
    status: 'answered',
    followUpQuestions: SUMMARY_FOLLOW_UPS,
  };
}

export interface MockLlmOptions {
  /** Characters per streamed chunk. */
  readonly chunkSize?: number;
  /** Pause between chunks, to make streaming visible in a demo. 0 in tests. */
  readonly chunkDelayMs?: number;
}

/** Keys are in the real schema's order (answer, citations, status, follow-ups), so streaming behaves the same. */
function buildAnswer({ question, sources }: Grounding): AnswerPayload {
  const summaryRequest = SUMMARY_REQUEST.test(question);
  const questionTokens = new Set(
    significantTokens(question).filter((token) => !(summaryRequest && REQUEST_WORDS.has(token))),
  );
  let best: { sourceId: string; sentence: string; score: number } | undefined;

  for (const source of sources) {
    for (const sentence of splitSentences(source.text)) {
      const tokens = new Set(significantTokens(sentence));
      const score = [...questionTokens].filter((token) => tokens.has(token)).length;
      if (!best || score > best.score) best = { sourceId: source.id, sentence, score };
    }
  }

  if (!best || best.score === 0) {
    const summary = summaryRequest ? summarize(sources) : null;
    return (
      summary ?? {
        answer: "I couldn't find that in this document.",
        citations: [],
        status: 'not_found',
        followUpQuestions: [],
      }
    );
  }

  return {
    answer: `${best.sentence} [${best.sourceId}]`,
    citations: [{ sourceId: best.sourceId, quote: firstWords(best.sentence) }],
    status:
      best.score / questionTokens.size >= STRONG_MATCH_RATIO ? 'answered' : 'partially_answered',
    followUpQuestions: [
      'Can you summarize this document?',
      'Which dates or deadlines does it mention?',
    ],
  };
}

/** Offline model stand-in; put #fail, #blocked or #malformed in a question to force that failure. */
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model = 'mock-extractive-1';

  constructor(private readonly options: MockLlmOptions = {}) {
    const { chunkSize } = options;
    if (chunkSize !== undefined && !(Number.isInteger(chunkSize) && chunkSize >= 1))
      throw new RangeError('chunkSize must be a positive integer');
  }

  async *generateStream(request: LlmRequest): AsyncGenerator<LlmEvent> {
    const { grounding, signal } = request;
    if (!grounding)
      throw new AiProviderError('The mock provider needs grounding', { retryable: false });

    const inputTokens = estimateTokens(request.systemInstruction + request.userContent);
    const usage = (output: string) => ({
      inputTokens,
      outputTokens: estimateTokens(output),
      thinkingTokens: 0,
    });

    if (grounding.question.includes('#fail')) {
      throw new AiProviderError('Simulated provider outage', { retryable: false, status: 503 });
    }
    if (grounding.question.includes('#blocked')) {
      yield {
        type: 'done',
        usage: usage(''),
        finishReason: 'blocked',
        providerFinishReason: 'MOCK_SAFETY',
      };
      return;
    }

    const json = grounding.question.includes('#malformed')
      ? '{"answer":"This reply is cut o'
      : JSON.stringify(buildAnswer(grounding));

    for (const text of splitAtWidth(json, this.options.chunkSize ?? 16)) {
      signal?.throwIfAborted();
      yield { type: 'text', text };
      if (this.options.chunkDelayMs) await abortableSleep(this.options.chunkDelayMs, signal);
    }
    yield {
      type: 'done',
      usage: usage(json),
      finishReason: 'stop',
      providerFinishReason: 'MOCK_STOP',
    };
  }
}
