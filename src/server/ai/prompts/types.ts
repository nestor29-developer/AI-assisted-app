import type { ReasoningEffort } from '@/server/ai/providers/types';

export interface PromptSource {
  readonly id: string;
  /** 1-based page for PDFs, null otherwise. */
  readonly page: number | null;
  readonly text: string;
}

export interface HistoryTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface PromptInput {
  readonly question: string;
  readonly history: readonly HistoryTurn[];
  readonly sources: readonly [PromptSource, ...PromptSource[]];
  /** Whether the sources are the whole document or only retrieved excerpts of it. */
  readonly scope: 'full' | 'excerpts';
  /** Random per request, so untrusted text cannot forge the closing tag of a block. */
  readonly nonce: string;
}

export interface BuiltPrompt {
  readonly systemInstruction: string;
  readonly userContent: string;
  readonly responseSchema: Readonly<Record<string, unknown>>;
  readonly maxOutputTokens: number;
  readonly reasoningEffort: ReasoningEffort;
}

export interface PromptTemplate {
  readonly id: string;
  readonly version: string;
  build(input: PromptInput): BuiltPrompt;
}
