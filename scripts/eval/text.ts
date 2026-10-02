import { stripSourceMarkers } from '@/shared/source-markers';

/** Case, width, spacing and [S#] markers never decide a match: "[S3]" must not satisfy "3". */
export const squash = (text: string): string =>
  stripSourceMarkers(text).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Letters and digits only, so a quote and its source compare equal whatever the punctuation. */
export const words = (text: string): string =>
  squash(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Whole-word containment on `words` form: "the cat" is not inside "the category". */
export const hasWords = (haystack: string, needle: string): boolean => {
  const target = words(needle);
  return target !== '' && ` ${words(haystack)} `.includes(` ${target} `);
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The phrase as a whole token: "3" is not in "30" or "3.5"; "30." counts, "30,000" does not. */
export function containsPhrase(haystack: string, phrase: string): boolean {
  const target = squash(phrase);
  if (target === '') return false;
  const before = /^[\p{L}\p{N}]/u.test(target) ? '(?<![\\p{L}\\p{N}])' : '';
  const after = /[\p{L}\p{N}]$/u.test(target) ? '(?![\\p{L}\\p{N}]|[.,][\\p{L}\\p{N}])' : '';
  return new RegExp(`${before}${escapeRegExp(target)}${after}`, 'u').test(squash(haystack));
}
