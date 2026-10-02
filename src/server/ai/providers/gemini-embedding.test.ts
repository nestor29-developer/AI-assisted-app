import { ApiError, EmbedContentResponse, type EmbedContentParameters } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';

import { EMBEDDING_DIMENSIONS } from '@/server/core/constants';

import { AiProviderError } from './errors';
import { GeminiEmbeddingProvider, type GeminiEmbeddingClient } from './gemini-embedding';

const vector = (fill = 0.1) => new Array<number>(EMBEDDING_DIMENSIONS).fill(fill);

function responseWith(vectors: number[][]): EmbedContentResponse {
  const response = new EmbedContentResponse();
  response.embeddings = vectors.map((values) => ({ values }));
  return response;
}

function setup(respond: (params: EmbedContentParameters) => Promise<EmbedContentResponse>) {
  const embedContent = vi.fn(respond);
  const client: GeminiEmbeddingClient = { models: { embedContent } };
  return {
    provider: new GeminiEmbeddingProvider({ apiKey: 'k', model: 'gemini-embedding-2', client }),
    embedContent,
  };
}

describe('GeminiEmbeddingProvider: the request it sends', () => {
  it('declares the task in the text: a titled document template and a question-answering query template', async () => {
    const { provider, embedContent } = setup(async (p) =>
      responseWith(Array.from({ length: (p.contents as unknown[]).length }, () => vector())),
    );

    await provider.embed(['first chunk', 'second chunk'], 'document', { title: 'Handbook' });
    await provider.embed(['What is the policy?'], 'query');

    const documentContents = embedContent.mock.calls[0]![0].contents as {
      parts: { text: string }[];
    }[];
    const queryContents = embedContent.mock.calls[1]![0].contents as {
      parts: { text: string }[];
    }[];
    expect(documentContents.map((c) => c.parts[0]!.text)).toEqual([
      'title: Handbook | text: first chunk',
      'title: Handbook | text: second chunk',
    ]);
    expect(queryContents[0]!.parts[0]!.text).toBe(
      'task: question answering | query: What is the policy?',
    );
  });

  it('uses "none" when a document has no title', async () => {
    const { provider, embedContent } = setup(async () => responseWith([vector()]));

    await provider.embed(['text'], 'document', { title: '   ' });

    const contents = embedContent.mock.calls[0]![0].contents as { parts: { text: string }[] }[];
    expect(contents[0]!.parts[0]!.text).toBe('title: none | text: text');
  });

  it('sends one Content per text (plain parts would be merged into a single embedding) at 768 dimensions', async () => {
    const { provider, embedContent } = setup(async () =>
      responseWith([vector(), vector(), vector()]),
    );
    const controller = new AbortController();

    await provider.embed(['a', 'b', 'c'], 'document', { signal: controller.signal });

    const params = embedContent.mock.calls[0]![0];
    expect(params.model).toBe('gemini-embedding-2');
    expect(params.contents).toHaveLength(3);
    expect(params.config).toMatchObject({
      outputDimensionality: 768,
      abortSignal: controller.signal,
    });
  });
});

describe('GeminiEmbeddingProvider: what it returns', () => {
  it('returns the vectors in order, with a token estimate for cost accounting', async () => {
    const { provider } = setup(async () => responseWith([vector(0.1), vector(0.2)]));

    const result = await provider.embed(['x'.repeat(400), 'y'.repeat(400)], 'document');

    expect(result.vectors).toHaveLength(2);
    expect(result.vectors[0]![0]).toBe(0.1);
    expect(result.vectors[1]![0]).toBe(0.2);
    expect(result.inputTokens).toBeGreaterThan(200);
  });

  it.each([
    ['the wrong number of vectors', [vector()], 2],
    [
      'vectors of the wrong dimension',
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
      2,
    ],
  ])('refuses a response with %s instead of storing garbage', async (_label, vectors, count) => {
    const { provider } = setup(async () => responseWith(vectors));

    const error = await provider
      .embed(
        Array.from({ length: count }, () => 't'),
        'document',
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AiProviderError);
    expect(error).toMatchObject({ retryable: false });
  });
});

describe('GeminiEmbeddingProvider: failures', () => {
  it('classifies a rate limit as retryable and a bad request as final', async () => {
    const limited = setup(async () => {
      throw new ApiError({ message: 'quota', status: 429 });
    });
    const invalid = setup(async () => {
      throw new ApiError({ message: 'bad', status: 400 });
    });

    await expect(limited.provider.embed(['t'], 'query')).rejects.toMatchObject({
      retryable: true,
      status: 429,
    });
    await expect(invalid.provider.embed(['t'], 'query')).rejects.toMatchObject({
      retryable: false,
      status: 400,
    });
  });

  it('lets aborts pass through untouched', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    const { provider } = setup(async () => {
      throw abort;
    });

    await expect(provider.embed(['t'], 'query')).rejects.toBe(abort);
  });
});
