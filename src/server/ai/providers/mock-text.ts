const STOPWORDS = new Set(
  (
    'a an and are as at be but by can do does for from had has have how i if in is it its me my of on or ' +
    'our so than that the their them then there these they this to us was we were what when where which ' +
    'who why will with would you your'
  ).split(' '),
);

/** Lowercased word tokens with a light plural stripping; enough for the offline demo providers. */
export function significantTokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((token) => !STOPWORDS.has(token))
    .map((token) => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token));
}

export function splitSentences(text: string): string[] {
  return (
    text
      // Latin marks need trailing whitespace (so "1.5" stays whole); CJK full stops do not.
      .split(/(?<=[.!?])\s+|(?<=[。！？])\s*|\n+/u)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0)
  );
}
