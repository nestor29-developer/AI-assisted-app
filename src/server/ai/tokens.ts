/** Rough English-biased estimate (about 4 characters per token); good enough for budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
