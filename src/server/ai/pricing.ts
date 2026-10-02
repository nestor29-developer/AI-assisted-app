import type { TokenUsage } from './providers/types';

interface PriceWindow {
  /** USD per million tokens. Reasoning tokens are billed as output. */
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  /** Exclusive end of this price; later prices apply afterwards. */
  readonly until?: Date;
}

// Source: ai.google.dev/gemini-api/docs/pricing, checked 2026-10-01 (paid tier, standard).
const PRICES = new Map<string, readonly PriceWindow[]>([
  [
    'gemini-3.8-flash',
    [
      { inputPerMillion: 0.75, outputPerMillion: 3.75, until: new Date('2027-01-01T00:00:00Z') },
      { inputPerMillion: 1.5, outputPerMillion: 7.5 },
    ],
  ],
  ['gemini-3.5-flash', [{ inputPerMillion: 1.5, outputPerMillion: 9 }]],
  ['gemini-3.5-flash-lite', [{ inputPerMillion: 0.3, outputPerMillion: 2.5 }]],
  ['gemini-embedding-2', [{ inputPerMillion: 0.2, outputPerMillion: 0 }]],
  ['mock-extractive-1', [{ inputPerMillion: 0, outputPerMillion: 0 }]],
  ['mock-hashed-bow-1', [{ inputPerMillion: 0, outputPerMillion: 0 }]],
]);

function priceAt(model: string, at: Date): PriceWindow | undefined {
  if (Number.isNaN(at.getTime())) return undefined;
  return PRICES.get(model)?.find((window) => window.until === undefined || at < window.until);
}

const isTokenCount = (value: number) => Number.isFinite(value) && value >= 0;

/** USD for one generation, or null when the price or the token counts are unknown (better than a wrong figure). */
export function estimateCostUsd(
  model: string,
  usage: TokenUsage,
  at: Date = new Date(),
): number | null {
  const price = priceAt(model, at);
  const counts = [usage.inputTokens, usage.outputTokens, usage.thinkingTokens];
  if (!price || !counts.every(isTokenCount)) return null;

  const output = usage.outputTokens + usage.thinkingTokens;
  return (usage.inputTokens * price.inputPerMillion + output * price.outputPerMillion) / 1_000_000;
}

export function estimateEmbeddingCostUsd(
  model: string,
  inputTokens: number,
  at: Date = new Date(),
): number | null {
  const price = priceAt(model, at);
  return price && isTokenCount(inputTokens)
    ? (inputTokens * price.inputPerMillion) / 1_000_000
    : null;
}
