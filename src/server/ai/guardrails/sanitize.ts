export interface SanitizeResult {
  readonly text: string;
  readonly removed: {
    /** Tag characters and variation selectors: invisible channels that can carry a hidden instruction. */
    readonly hiddenText: number;
    readonly bidiControls: number;
    /** Other default-ignorable characters, such as zero-width spaces and soft hyphens. */
    readonly invisible: number;
    readonly controls: number;
  };
}

// Braced escapes on purpose: they stay readable and cannot turn into raw invisible characters in the source.
const HIDDEN_TEXT = /[\u{E0000}-\u{E0FFF}\u{FE00}-\u{FE0D}\u{180B}-\u{180D}\u{180F}]/gu;
const BIDI_CONTROLS = /[\u{061C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu;
// The joiners (U+200C/D) and emoji presentation selectors (U+FE0E/F) stay: real scripts and emoji need them.
const INVISIBLE = /(?![\u{200C}\u{200D}\u{FE0E}\u{FE0F}])\p{Default_Ignorable_Code_Point}/gu;
// Page and line breaks become newlines and unit separators become spaces, so words never fuse together.
const LINE_BREAKS = /[\f\v\u{85}\u{2028}\u{2029}]/gu;
const UNIT_SEPARATORS = /[\u{1C}-\u{1F}]/gu;
// Other control characters go; NUL in particular cannot be stored in Postgres.
const CONTROLS = /[\u{0}-\u{8}\u{E}-\u{1B}\u{7F}-\u{9F}]/gu;

function replaceCounting(
  text: string,
  pattern: RegExp,
  replacement: string,
): { text: string; count: number } {
  let count = 0;
  const replaced = text.replace(pattern, () => {
    count += 1;
    return replacement;
  });
  return { text: replaced, count };
}

/** Makes untrusted text safe to store, embed and place in a prompt, and reports what was removed. */
export function sanitizeText(input: string): SanitizeResult {
  const normalizedNewlines = input.toWellFormed().replace(/\r\n?/g, '\n');
  const hidden = replaceCounting(normalizedNewlines, HIDDEN_TEXT, '');
  const bidi = replaceCounting(hidden.text, BIDI_CONTROLS, '');
  const invisible = replaceCounting(bidi.text, INVISIBLE, '');
  const breaks = replaceCounting(invisible.text, LINE_BREAKS, '\n');
  const separators = replaceCounting(breaks.text, UNIT_SEPARATORS, ' ');
  const controls = replaceCounting(separators.text, CONTROLS, '');

  return {
    text: controls.text.normalize('NFC'),
    removed: {
      hiddenText: hidden.count,
      bidiControls: bidi.count,
      invisible: invisible.count,
      controls: breaks.count + separators.count + controls.count,
    },
  };
}

/** Hidden-text channels are a strong injection signal; zero-width spaces and soft hyphens are not. */
export const hasHiddenText = ({ removed }: SanitizeResult): boolean =>
  removed.hiddenText + removed.bidiControls > 0;
