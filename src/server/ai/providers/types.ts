export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

/** Provider-neutral outcome. `blocked` covers safety, recitation and prompt-level policy blocks. */
export type FinishReason = 'stop' | 'length' | 'blocked' | 'other';

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Reasoning tokens are billed as output, so cost math must add them. */
  readonly thinkingTokens: number;
}

export interface GroundingSource {
  readonly id: string;
  readonly text: string;
}

/** Real providers ignore this; the offline mock answers from it, and native-citation APIs could use it. */
export interface Grounding {
  readonly question: string;
  readonly sources: readonly GroundingSource[];
}

export interface LlmRequest {
  readonly systemInstruction: string;
  readonly userContent: string;
  /** Plain JSON Schema for the structured answer. */
  readonly responseSchema: Readonly<Record<string, unknown>>;
  readonly maxOutputTokens: number;
  readonly reasoningEffort: ReasoningEffort;
  readonly seed?: number;
  readonly grounding?: Grounding;
  readonly signal?: AbortSignal;
}

export type LlmEvent =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'done';
      readonly usage: TokenUsage;
      readonly finishReason: FinishReason;
      /** The provider's own label, kept verbatim for the audit trail. */
      readonly providerFinishReason: string | null;
    };

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generateStream(request: LlmRequest): AsyncIterable<LlmEvent>;
}

export type EmbeddingPurpose = 'document' | 'query';

export interface EmbedOptions {
  /** Document title; some models embed it together with the text. */
  readonly title?: string;
  readonly signal?: AbortSignal;
}

export interface EmbeddingResult {
  readonly vectors: readonly (readonly number[])[];
  /** Estimated when the provider does not report usage; used for cost accounting. */
  readonly inputTokens: number;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embed(
    texts: readonly string[],
    purpose: EmbeddingPurpose,
    options?: EmbedOptions,
  ): Promise<EmbeddingResult>;
}
