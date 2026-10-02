import {
  ApiError,
  BlockedReason,
  FinishReason,
  GenerateContentResponse,
  ThinkingLevel,
} from '@google/genai';
import { describe, expect, it, vi } from 'vitest';

import { AiProviderError } from './errors';
import { GeminiLlmProvider, type GeminiStreamingClient } from './gemini-llm';
import type { LlmEvent, LlmRequest } from './types';

interface ChunkInit {
  text?: string;
  usage?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  finishReason?: FinishReason;
  blockReason?: BlockedReason;
}

function chunk({ text, usage, finishReason, blockReason }: ChunkInit): GenerateContentResponse {
  const response = new GenerateContentResponse();
  response.candidates = [
    {
      content: { role: 'model', parts: text === undefined ? [] : [{ text }] },
      ...(finishReason ? { finishReason } : {}),
    },
  ];
  if (usage) response.usageMetadata = usage;
  if (blockReason) response.promptFeedback = { blockReason };
  return response;
}

async function* streamOf(chunks: GenerateContentResponse[], failure?: unknown) {
  for (const item of chunks) yield item;
  if (failure) throw failure;
}

function setup(chunks: GenerateContentResponse[], failure?: unknown) {
  const generateContentStream = vi.fn<GeminiStreamingClient['models']['generateContentStream']>(
    async () => streamOf(chunks, failure),
  );
  const client: GeminiStreamingClient = { models: { generateContentStream } };
  return {
    provider: new GeminiLlmProvider({ apiKey: 'test-key', model: 'gemini-3.8-flash', client }),
    generateContentStream,
  };
}

const request: LlmRequest = {
  systemInstruction: 'Be brief.',
  userContent: 'What is the policy?',
  responseSchema: { type: 'object', properties: { answer: { type: 'string' } } },
  maxOutputTokens: 4_096,
  reasoningEffort: 'low',
};

async function run(provider: GeminiLlmProvider, req: LlmRequest = request): Promise<LlmEvent[]> {
  const events: LlmEvent[] = [];
  for await (const event of provider.generateStream(req)) events.push(event);
  return events;
}

describe('GeminiLlmProvider: the request it sends', () => {
  it('asks for schema-constrained JSON with a low thinking level and no sampling overrides', async () => {
    const { provider, generateContentStream } = setup([
      chunk({ text: '{}', finishReason: FinishReason.STOP }),
    ]);
    const controller = new AbortController();

    await run(provider, { ...request, seed: 7, signal: controller.signal });

    const params = generateContentStream.mock.calls[0]![0];
    expect(params).toMatchObject({
      model: 'gemini-3.8-flash',
      contents: 'What is the policy?',
      config: {
        systemInstruction: 'Be brief.',
        responseMimeType: 'application/json',
        responseJsonSchema: request.responseSchema,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        maxOutputTokens: 4_096,
        seed: 7,
        abortSignal: controller.signal,
      },
    });
    // Google advises leaving these at their defaults on Gemini 3.x.
    for (const key of ['temperature', 'topP', 'topK'])
      expect(params.config).not.toHaveProperty(key);
  });

  it('omits the seed and the abort signal when none were given', async () => {
    const { provider, generateContentStream } = setup([chunk({})]);

    await run(provider);

    const config = generateContentStream.mock.calls[0]![0].config!;
    expect(config).not.toHaveProperty('seed');
    expect(config).not.toHaveProperty('abortSignal');
  });

  it.each([
    ['minimal', ThinkingLevel.LOW],
    ['low', ThinkingLevel.LOW],
    ['medium', ThinkingLevel.MEDIUM],
    ['high', ThinkingLevel.HIGH],
  ] as const)(
    'maps reasoning effort %s to %s (minimal is never sent: 3.8 rejects it)',
    async (effort, level) => {
      const { provider, generateContentStream } = setup([chunk({})]);

      await run(provider, { ...request, reasoningEffort: effort });

      expect(generateContentStream.mock.calls[0]![0].config!.thinkingConfig).toEqual({
        thinkingLevel: level,
      });
    },
  );
});

describe('GeminiLlmProvider: what it returns', () => {
  it('streams text and finishes with usage that separates reasoning tokens', async () => {
    const { provider } = setup([
      chunk({ text: '{"answer":"Ye' }),
      chunk({
        text: 's"}',
        usage: { promptTokenCount: 1_200, candidatesTokenCount: 30, thoughtsTokenCount: 250 },
        finishReason: FinishReason.STOP,
      }),
    ]);

    const events = await run(provider);

    expect(
      events
        .filter((e) => e.type === 'text')
        .map((e) => e.type === 'text' && e.text)
        .join(''),
    ).toBe('{"answer":"Yes"}');
    expect(events.at(-1)).toEqual({
      type: 'done',
      usage: { inputTokens: 1_200, outputTokens: 30, thinkingTokens: 250 },
      finishReason: 'stop',
      providerFinishReason: 'STOP',
    });
  });

  it('skips empty chunks and uses the latest usage figures', async () => {
    const { provider } = setup([
      chunk({ usage: { promptTokenCount: 100, candidatesTokenCount: 1 } }),
      chunk({ text: 'a' }),
      chunk({
        usage: { promptTokenCount: 100, candidatesTokenCount: 9 },
        finishReason: FinishReason.STOP,
      }),
    ]);

    const events = await run(provider);

    expect(events.filter((e) => e.type === 'text')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      usage: { inputTokens: 100, outputTokens: 9, thinkingTokens: 0 },
    });
  });

  it.each([
    [FinishReason.MAX_TOKENS, 'length'],
    [FinishReason.SAFETY, 'blocked'],
    [FinishReason.RECITATION, 'blocked'],
    [FinishReason.PROHIBITED_CONTENT, 'blocked'],
    [FinishReason.SPII, 'blocked'],
    [FinishReason.OTHER, 'other'],
  ] as const)(
    'normalizes the provider finish reason %s to %s and keeps the original label',
    async (raw, expected) => {
      const { provider } = setup([chunk({ text: 'x', finishReason: raw })]);

      expect((await run(provider)).at(-1)).toMatchObject({
        finishReason: expected,
        providerFinishReason: raw,
      });
    },
  );

  it('reports a prompt blocked before generation as blocked, with the reason', async () => {
    const { provider } = setup([chunk({ blockReason: BlockedReason.SAFETY })]);

    const done = (await run(provider)).at(-1);

    expect(done).toMatchObject({
      type: 'done',
      finishReason: 'blocked',
      providerFinishReason: 'PROMPT_BLOCKED:SAFETY',
    });
  });
});

describe('GeminiLlmProvider: failures', () => {
  it('classifies a rate limit as retryable and surfaces Google’s retry hint', async () => {
    const generateContentStream = vi.fn(async () => {
      throw new ApiError({
        message: '{"error":{"code":429,"details":[{"retryDelay":"28s"}]}}',
        status: 429,
      });
    });
    const provider = new GeminiLlmProvider({
      apiKey: 'k',
      model: 'm',
      client: { models: { generateContentStream } },
    });

    const error = await run(provider).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AiProviderError);
    expect(error).toMatchObject({ retryable: true, status: 429, retryAfterMs: 28_000 });
  });

  it('does not retry client errors such as a bad API key', async () => {
    const generateContentStream = vi.fn(async () => {
      throw new ApiError({ message: 'API key not valid', status: 400 });
    });
    const provider = new GeminiLlmProvider({
      apiKey: 'k',
      model: 'm',
      client: { models: { generateContentStream } },
    });

    const error = await run(provider).catch((e: unknown) => e);

    expect(error).toMatchObject({ retryable: false, status: 400 });
  });

  it('maps a failure in the middle of the stream, after text was already delivered', async () => {
    const { provider } = setup(
      [chunk({ text: '{"answer":"par' })],
      new ApiError({ message: 'overloaded', status: 503 }),
    );
    const received: string[] = [];

    const consume = async () => {
      for await (const event of provider.generateStream(request))
        if (event.type === 'text') received.push(event.text);
    };

    await expect(consume()).rejects.toMatchObject({ retryable: true, status: 503 });
    expect(received).toEqual(['{"answer":"par']);
  });

  it('lets aborts through untouched, so the caller can tell a disconnect from an outage', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    const { provider } = setup([], abort);

    await expect(run(provider)).rejects.toBe(abort);
  });

  it('never puts the response body or the key in the error message it raises', async () => {
    const generateContentStream = vi.fn(async () => {
      throw new ApiError({
        message: 'secret-body: quota for key AIzaSyEXAMPLE exceeded',
        status: 429,
      });
    });
    const provider = new GeminiLlmProvider({
      apiKey: 'AIzaSyEXAMPLE',
      model: 'm',
      client: { models: { generateContentStream } },
    });

    const error = (await run(provider).catch((e: unknown) => e)) as Error;

    expect(error.message).not.toContain('secret-body');
    expect(error.message).not.toContain('AIzaSyEXAMPLE');
  });
});
