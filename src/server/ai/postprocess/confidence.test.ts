import { describe, expect, it } from 'vitest';

import { scoreConfidence } from './confidence';

const verified = { verified: true };
const unverified = { verified: false };

describe('scoreConfidence', () => {
  it.each([
    ['not_found', [], 'none'],
    ['not_found', [verified], 'none'],
    ['answered', [], 'low'],
    ['answered', [unverified], 'low'],
    ['answered', [unverified, unverified], 'low'],
    ['answered', [verified, unverified], 'medium'],
    ['answered', [verified], 'high'],
    ['answered', [verified, verified, verified], 'high'],
    ['partially_answered', [], 'low'],
    ['partially_answered', [unverified], 'low'],
    ['partially_answered', [verified, unverified], 'medium'],
    ['partially_answered', [verified, verified], 'medium'],
  ] as const)('%s with %j is %s', (status, citations, expected) => {
    expect(scoreConfidence(status, citations)).toBe(expected);
  });
});
