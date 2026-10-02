import { describe, expect, it } from 'vitest';

import { estimateCostUsd, estimateEmbeddingCostUsd } from './pricing';

const usage = { inputTokens: 2_000, outputTokens: 450, thinkingTokens: 50 };
const promo = new Date('2026-10-15T00:00:00Z');
const afterPromo = new Date('2027-01-01T00:00:00Z');

describe('estimateCostUsd', () => {
  it('prices reasoning tokens as output, at the promotional rate before 2027', () => {
    // (2000 x 0.75 + (450 + 50) x 3.75) / 1M
    expect(estimateCostUsd('gemini-3.8-flash', usage, promo)).toBeCloseTo(0.003375, 9);
  });

  it('switches to the list price on the promotion end date', () => {
    expect(estimateCostUsd('gemini-3.8-flash', usage, afterPromo)).toBeCloseTo(0.00675, 9);
    expect(
      estimateCostUsd('gemini-3.8-flash', usage, new Date('2026-12-31T23:59:59Z')),
    ).toBeCloseTo(0.003375, 9);
  });

  it('knows the older model and the lite model', () => {
    expect(estimateCostUsd('gemini-3.5-flash', usage, promo)).toBeCloseTo(0.0075, 9);
    expect(estimateCostUsd('gemini-3.5-flash-lite', usage, promo)).toBeCloseTo(0.00185, 9);
  });

  it('costs nothing for the offline mock', () => {
    expect(estimateCostUsd('mock-extractive-1', usage)).toBe(0);
  });

  it('returns null, not a misleading zero, for a model it has no price for', () => {
    expect(estimateCostUsd('some-future-model', usage)).toBeNull();
  });
});

describe('estimateEmbeddingCostUsd', () => {
  it('prices input tokens only', () => {
    expect(estimateEmbeddingCostUsd('gemini-embedding-2', 1_000_000)).toBeCloseTo(0.2, 9);
    expect(estimateEmbeddingCostUsd('unknown-embedder', 100)).toBeNull();
  });
});
