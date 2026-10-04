import { describe, expect, it } from 'vitest';

import { STARTER_QUESTIONS } from '@/components/chat/starter-questions';
import { SAMPLE_DOCUMENT } from '@/lib/sample-document';
import { processAnswer } from '@/server/ai/postprocess/process-answer';
import { MockLlmProvider } from '@/server/ai/providers/mock-llm';
import { chunkText } from '@/server/ai/rag/chunker';
import { estimateTokens } from '@/server/ai/tokens';
import { DEFAULT_FULL_CONTEXT_MAX_TOKENS } from '@/server/core/constants';

const sources = chunkText(SAMPLE_DOCUMENT.text).map((chunk, index) => ({
  id: `S${index + 1}`,
  chunkId: `chunk-${index + 1}`,
  page: null,
  text: chunk.text,
}));

async function answerFromMock(question: string) {
  const llm = new MockLlmProvider({ chunkSize: 64 });
  let raw = '';
  for await (const event of llm.generateStream({
    systemInstruction: '',
    userContent: '',
    responseSchema: {},
    maxOutputTokens: 1_000,
    reasoningEffort: 'low',
    grounding: { question, sources },
  })) {
    if (event.type === 'text') raw += event.text;
  }
  return processAnswer({ raw, finishReason: 'stop', sources });
}

describe('the sample document', () => {
  it('is small enough to go to the model whole, with room to spare', () => {
    expect(estimateTokens(SAMPLE_DOCUMENT.text)).toBeLessThan(DEFAULT_FULL_CONTEXT_MAX_TOKENS / 4);
    expect(SAMPLE_DOCUMENT.text.length).toBeGreaterThan(1_200);
    expect(SAMPLE_DOCUMENT.text.length).toBeLessThan(1_800);
  });

  it.each(STARTER_QUESTIONS)(
    'answers the starter question "%s" from itself, with verified quotes',
    async (question) => {
      const answer = await answerFromMock(question);

      expect(answer.status).toBe('answered');
      expect(answer.confidence).toBe('high');
      expect(answer.warnings).toEqual([]);
      expect(answer.citations.length).toBeGreaterThan(0);
      for (const citation of answer.citations) expect(citation.verified).toBe(true);
    },
  );

  it('gives a summary that opens with what the document is for', async () => {
    const answer = await answerFromMock(STARTER_QUESTIONS[0]);

    expect(answer.answer).toMatch(/^This handbook explains/);
  });

  it('finds the dates and deadlines where the document states them', async () => {
    const answer = await answerFromMock(STARTER_QUESTIONS[1]);

    expect(answer.answer).toMatch(/expense reports are due on the 5th/);
    expect(answer.answer).toMatch(/November 30/);
  });
});
