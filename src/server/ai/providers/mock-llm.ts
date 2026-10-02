import type { AnswerPayload } from '@/server/ai/prompts/document-qa/output-schema';
import { estimateTokens } from '@/server/ai/tokens';
import { splitAtWidth } from '@/server/core/text';

import { AiProviderError } from './errors';
import { abortableSleep } from './retry';
import { significantTokens, splitSentences } from './mock-text';
import type { Grounding, LlmEvent, LlmProvider, LlmRequest } from './types';

const MAX_QUOTE_WORDS = 25;
const STRONG_MATCH_RATIO = 0.5;

export interface MockLlmOptions {
  /** Characters per streamed chunk. */
  readonly chunkSize?: number;
  /** Pause between chunks, to make streaming visible in a demo. 0 in tests. */
  readonly chunkDelayMs?: number;
}

/** Keys are in the real schema's order (answer, citations, status, follow-ups), so streaming behaves the same. */
function buildAnswer({ question, sources }: Grounding): AnswerPayload {
  const questionTokens = new Set(significantTokens(question));
  let best: { sourceId: string; sentence: string; score: number } | undefined;

  for (const source of sources) {
    for (const sentence of splitSentences(source.text)) {
      const tokens = new Set(significantTokens(sentence));
      const score = [...questionTokens].filter((token) => tokens.has(token)).length;
      if (!best || score > best.score) best = { sourceId: source.id, sentence, score };
    }
  }

  if (!best || best.score === 0) {
    return {
      answer: "I couldn't find that in this document.",
      citations: [],
      status: 'not_found',
      followUpQuestions: [],
    };
  }

  const quote = best.sentence.split(/\s+/).slice(0, MAX_QUOTE_WORDS).join(' ');
  return {
    answer: `${best.sentence} [${best.sourceId}]`,
    citations: [{ sourceId: best.sourceId, quote }],
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
