import {
  FinishReason as GeminiFinishReason,
  GoogleGenAI,
  ThinkingLevel,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from '@google/genai';

import { mapGeminiError } from './gemini-errors';
import type {
  FinishReason,
  LlmEvent,
  LlmProvider,
  LlmRequest,
  ReasoningEffort,
  TokenUsage,
} from './types';

/** The slice of the SDK this adapter uses, so tests can supply a stub instead of the network. */
export interface GeminiStreamingClient {
  models: {
    generateContentStream(
      params: GenerateContentParameters,
    ): Promise<AsyncGenerator<GenerateContentResponse>>;
  };
}

export interface GeminiLlmOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly client?: GeminiStreamingClient;
}

/** gemini-3.8-flash rejects "minimal", so it is never sent; "low" is the cheapest level that works everywhere. */
const THINKING_LEVELS: Readonly<Record<ReasoningEffort, ThinkingLevel>> = {
  minimal: ThinkingLevel.LOW,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

/** Safety, copyright and policy stops all mean "no usable answer"; the app shows them as declined. */
const BLOCKING_FINISH_REASONS = new Set<string>([
  GeminiFinishReason.SAFETY,
  GeminiFinishReason.RECITATION,
  GeminiFinishReason.BLOCKLIST,
  GeminiFinishReason.PROHIBITED_CONTENT,
  GeminiFinishReason.SPII,
  GeminiFinishReason.LANGUAGE,
]);

function normalizeFinishReason(raw: string | undefined, promptBlocked: boolean): FinishReason {
  if (promptBlocked) return 'blocked';
  if (raw === undefined || raw === GeminiFinishReason.STOP) return 'stop';
  if (raw === GeminiFinishReason.MAX_TOKENS) return 'length';
  return BLOCKING_FINISH_REASONS.has(raw) ? 'blocked' : 'other';
}

export class GeminiLlmProvider implements LlmProvider {
  readonly name = 'gemini';
  readonly model: string;
  private readonly client: GeminiStreamingClient;

  constructor({ apiKey, model, client }: GeminiLlmOptions) {
    this.model = model;
    this.client = client ?? new GoogleGenAI({ apiKey });
  }

  async *generateStream(request: LlmRequest): AsyncGenerator<LlmEvent> {
    let stream: AsyncGenerator<GenerateContentResponse>;
    try {
      stream = await this.client.models.generateContentStream({
        model: this.model,
        contents: request.userContent,
        config: {
          systemInstruction: request.systemInstruction,
          responseMimeType: 'application/json',
          responseJsonSchema: request.responseSchema,
          thinkingConfig: { thinkingLevel: THINKING_LEVELS[request.reasoningEffort] },
          maxOutputTokens: request.maxOutputTokens,
          ...(request.seed === undefined ? {} : { seed: request.seed }),
          ...(request.signal ? { abortSignal: request.signal } : {}),
        },
      });
    } catch (error) {
      throw mapGeminiError(error);
    }

    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
    let rawFinishReason: string | undefined;
    let promptBlockReason: string | undefined;

    try {
      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) yield { type: 'text', text };

        const metadata = chunk.usageMetadata;
        if (metadata) {
          usage = {
            inputTokens: metadata.promptTokenCount ?? 0,
            outputTokens: metadata.candidatesTokenCount ?? 0,
            thinkingTokens: metadata.thoughtsTokenCount ?? 0,
          };
        }
        rawFinishReason = chunk.candidates?.[0]?.finishReason ?? rawFinishReason;
        promptBlockReason = chunk.promptFeedback?.blockReason ?? promptBlockReason;
      }
    } catch (error) {
      throw mapGeminiError(error);
    }

    yield {
      type: 'done',
      usage,
      finishReason: normalizeFinishReason(rawFinishReason, promptBlockReason !== undefined),
      providerFinishReason: promptBlockReason
        ? `PROMPT_BLOCKED:${promptBlockReason}`
        : (rawFinishReason ?? null),
    };
  }
}
