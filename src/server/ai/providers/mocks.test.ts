import { describe, expect, it } from 'vitest';

import { verifyQuote } from '@/server/ai/postprocess/citations';
import { buildAnswerSchema } from '@/server/ai/prompts/document-qa/output-schema';
import { EMBEDDING_DIMENSIONS } from '@/server/core/constants';

import { AiProviderError } from './errors';
import { MockEmbeddingProvider } from './mock-embedding';
import { MockLlmProvider } from './mock-llm';
import type { EmbeddingProvider, Grounding, LlmEvent, LlmRequest } from './types';

const sources = [
  {
    id: 'S1',
    text: 'Employees accrue 1.5 vacation days per month. Unused days expire on March 31.',
  },
  {
    id: 'S2',
    text: 'The office is closed on public holidays.\nRemote work requires manager approval.',
  },
] as const;

function request(question: string, overrides: Partial<LlmRequest> = {}): LlmRequest {
  const grounding: Grounding = { question, sources };
  return {
    systemInstruction: 'system',
    userContent: 'user content',
    responseSchema: {},
    maxOutputTokens: 100,
    reasoningEffort: 'low',
    grounding,
    ...overrides,
  };
}

async function run(llm: MockLlmProvider, req: LlmRequest) {
  const events: LlmEvent[] = [];
  for await (const event of llm.generateStream(req)) events.push(event);
  const text = events.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join('');
  const done = events.find((e) => e.type === 'done');
  return { events, text, done };
}

const cosine = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, v, i) => sum + v * b[i]!, 0);

describe('MockEmbeddingProvider', () => {
  const embeddings: EmbeddingProvider = new MockEmbeddingProvider();

  it('returns unit-length vectors of the configured dimension', async () => {
    const { vectors } = await embeddings.embed(
      ['vacation days per month', 'office closed on holidays'],
      'document',
    );

    expect(vectors).toHaveLength(2);
    for (const vector of vectors) {
      expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
      expect(Math.hypot(...vector)).toBeCloseTo(1, 6);
    }
  });

  it('is deterministic', async () => {
    const [a, b] = await Promise.all([
      embeddings.embed(['same text'], 'query'),
      embeddings.embed(['same text'], 'query'),
    ]);
    expect(a.vectors).toEqual(b.vectors);
  });

  it('places related texts closer than unrelated ones (so offline retrieval works)', async () => {
    const { vectors } = await embeddings.embed(
      [
        'How many vacation days do employees get?',
        'Employees accrue 1.5 vacation days per month.',
        'The server rack needs cooling fans.',
      ],
      'document',
    );

    expect(cosine(vectors[0]!, vectors[1]!)).toBeGreaterThan(
      cosine(vectors[0]!, vectors[2]!) + 0.2,
    );
  });

  it('still returns a valid unit vector for text with no meaningful words', async () => {
    const { vectors } = await embeddings.embed(['the and of', ''], 'query');
    for (const vector of vectors) expect(Math.hypot(...vector)).toBeCloseTo(1, 6);
  });

  it('reports an input token estimate for cost accounting', async () => {
    expect((await embeddings.embed(['x'.repeat(400)], 'document')).inputTokens).toBe(100);
  });
});

describe('MockLlmProvider', () => {
  const llm = new MockLlmProvider({ chunkSize: 10 });
  const schema = buildAnswerSchema(['S1', 'S2']);

  it('answers from the best matching source and cites it with a verbatim quote', async () => {
    const { text } = await run(
      llm,
      request('How many vacation days do employees accrue per month?'),
    );

    const answer = schema.parse(JSON.parse(text));
    expect(answer.status).toBe('answered');
    expect(answer.answer).toContain('1.5 vacation days per month');
    expect(answer.answer).toContain('[S1]');
    expect(answer.citations).toHaveLength(1);
    expect(answer.citations[0]!.sourceId).toBe('S1');
    expect(sources[0].text).toContain(answer.citations[0]!.quote);
    expect(answer.citations[0]!.quote.split(/\s+/).length).toBeLessThanOrEqual(25);
  });

  it('says not_found, with no citations, when nothing in the sources relates to the question', async () => {
    const answer = schema.parse(
      JSON.parse((await run(llm, request('What is the CEO salary?'))).text),
    );

    expect(answer).toMatchObject({ status: 'not_found', citations: [], followUpQuestions: [] });
  });

  it('downgrades to partially_answered when only a little of the question is covered', async () => {
    const answer = schema.parse(
      JSON.parse(
        (
          await run(
            llm,
            request('Is remote work approved and who pays for the home office equipment budget?'),
          )
        ).text,
      ),
    );

    expect(answer.status).toBe('partially_answered');
  });

  it('streams in small chunks and finishes with usage and a normalized finish reason', async () => {
    const { events, done } = await run(llm, request('vacation days per month'));

    expect(events.filter((e) => e.type === 'text').length).toBeGreaterThan(3);
    expect(events.at(-1)).toBe(done);
    expect(done).toMatchObject({
      finishReason: 'stop',
      providerFinishReason: 'MOCK_STOP',
      usage: { thinkingTokens: 0 },
    });
    expect(done?.type === 'done' && done.usage.outputTokens).toBeGreaterThan(0);
  });

  it('never splits a surrogate pair across chunks', async () => {
    const emoji = {
      ...request('party time'),
      grounding: {
        question: 'party time',
        sources: [
          { id: 'S1', text: 'Party time \u{1F389}\u{1F389}\u{1F389}\u{1F389} is on Friday.' },
        ],
      },
    };

    const { events } = await run(new MockLlmProvider({ chunkSize: 1 }), emoji);

    for (const event of events)
      if (event.type === 'text') expect(event.text.isWellFormed()).toBe(true);
  });

  it('simulates an outage on demand with a non-retryable provider error', async () => {
    const error = await run(llm, request('please #fail now')).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AiProviderError);
    expect(error).toMatchObject({ retryable: false, status: 503 });
  });

  it('simulates a safety block on demand: no text, finishReason blocked', async () => {
    const { text, done } = await run(llm, request('tell me #blocked things'));

    expect(text).toBe('');
    expect(done).toMatchObject({ type: 'done', finishReason: 'blocked' });
  });

  it('simulates malformed output on demand', async () => {
    const { text } = await run(llm, request('answer #malformed'));
    expect(() => JSON.parse(text)).toThrow();
  });

  it('stops streaming when the caller aborts', async () => {
    const controller = new AbortController();
    const received: string[] = [];

    const consume = async () => {
      for await (const event of llm.generateStream(
        request('vacation days per month', { signal: controller.signal }),
      )) {
        if (event.type === 'text') received.push(event.text);
        controller.abort();
      }
    };

    await expect(consume()).rejects.toThrow();
    expect(received).toHaveLength(1);
  });

  it('refuses to run without grounding rather than inventing an answer', async () => {
    await expect(run(llm, request('q', { grounding: undefined }))).rejects.toBeInstanceOf(
      AiProviderError,
    );
  });

  it('writes its JSON keys in the order of the real schema, so streaming behaves like Gemini', async () => {
    for (const question of ['vacation days per month', 'What is the CEO salary?']) {
      const { text } = await run(llm, request(question));

      expect(Object.keys(JSON.parse(text) as object)).toEqual(Object.keys(schema.shape));
    }
  });

  it.each([0, -1, 2.5, Number.NaN])(
    'rejects the chunk size %s instead of failing mid-stream',
    (chunkSize) => {
      expect(() => new MockLlmProvider({ chunkSize })).toThrow(RangeError);
    },
  );
});

describe('MockLlmProvider: a request for the gist', () => {
  const llm = new MockLlmProvider({ chunkSize: 10 });
  const schema = buildAnswerSchema(['S1', 'S2']);

  async function answerTo(question: string, grounded: Grounding['sources'] = sources) {
    const grounding: Grounding = { question, sources: grounded };
    const { text } = await run(llm, request(question, { grounding }));
    return schema.parse(JSON.parse(text));
  }

  it.each([
    'Summarize this document in a few sentences.',
    'What are the main points to remember?',
    'Give me an overview',
    'What are the key points?',
    'What is this document about?',
    'what is this about',
  ])('answers "%s" from the opening of the first source, and cites it', async (question) => {
    const answer = await answerTo(question);

    expect(answer.status).toBe('answered');
    expect(answer.answer).toContain('Employees accrue 1.5 vacation days per month.');
    expect(answer.answer).toContain('Unused days expire on March 31.');
    expect(answer.answer).toContain('[S1]');
    expect(answer.citations).toHaveLength(1);
    expect(answer.citations[0]!.sourceId).toBe('S1');
    expect(verifyQuote(answer.citations[0]!.quote, sources[0].text)).toBe(true);
  });

  it('uses at most the first three sentences', async () => {
    const answer = await answerTo('Summarize this', [
      { id: 'S1', text: 'One is here. Two is here. Three is here. Four is here.' },
    ]);

    expect(answer.answer).toBe('One is here. Two is here. Three is here. [S1]');
  });

  it('prefers the sentence that shares words with the question over a summary', async () => {
    const answer = await answerTo('Summarize the vacation days');

    expect(answer.answer).toBe('Employees accrue 1.5 vacation days per month. [S1]');
  });

  it('skips headings, which have no end mark and make a poor opening', async () => {
    const answer = await answerTo('Give me an overview', [
      {
        id: 'S1',
        text: '# Handbook\n\nThis handbook explains the leave rules. It applies to all staff.\n\nLeave\n\nStaff accrue days monthly.',
      },
    ]);

    expect(answer.answer).toBe(
      'This handbook explains the leave rules. It applies to all staff. Staff accrue days monthly. [S1]',
    );
  });

  it('quotes a sentence that was wrapped over two lines in the source, and still verifies', async () => {
    const text =
      'The handbook covers leave rules\nand expense rules for staff. It is updated yearly.';

    const answer = await answerTo('What is this document about?', [{ id: 'S1', text }]);

    expect(answer.citations[0]!.quote).toBe(
      'The handbook covers leave rules and expense rules for staff.',
    );
    expect(verifyQuote(answer.citations[0]!.quote, text)).toBe(true);
  });

  it('still says not_found for a question that is not asking for the gist', async () => {
    const answer = await answerTo('What is the CEO salary?');

    expect(answer).toMatchObject({ status: 'not_found', citations: [] });
  });

  it('says not_found when there is nothing to summarize', async () => {
    const answer = await answerTo('Summarize this document', []);

    expect(answer.status).toBe('not_found');
  });
});
