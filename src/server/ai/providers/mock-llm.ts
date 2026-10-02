import type { AnswerPayload } from '@/server/ai/prompts/document-qa/output-schema';
import { estimateTokens } from '@/server/ai/tokens';

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
      status: 'not_found',
      answer: "I couldn't find that in this document.",
      citations: [],
      followUpQuestions: [],
    };
  }

  const quote = best.sentence.split(/\s+/).slice(0, MAX_QUOTE_WORDS).join(' ');
  return {
    status:
      best.score / questionTokens.size >= STRONG_MATCH_RATIO ? 'answered' : 'partially_answered',
    answer: `${best.sentence} [${best.sourceId}]`,
    citations: [{ sourceId: best.sourceId, quote }],
    followUpQuestions: [
      'Can you summarize this document?',
      'Which dates or deadlines does it mention?',
    ],
  };
}

/** Cuts a string into chunks without splitting a surrogate pair. */
function chunk(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + size, text.length);
    const next = text.charCodeAt(end);
    // Step back off a pair; if that would stall (size 1), take the whole pair instead.
    if (end < text.length && next >= 0xdc00 && next <= 0xdfff)
      end = end - 1 > start ? end - 1 : end + 1;
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

/** Offline model stand-in; put #fail, #blocked or #malformed in a question to force that failure. */
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model = 'mock-extractive-1';

  constructor(private readonly options: MockLlmOptions = {}) {}

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
      ? '{"status":"answered","answer":"This reply is cut o'
      : JSON.stringify(buildAnswer(grounding));

    for (const text of chunk(json, this.options.chunkSize ?? 16)) {
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
