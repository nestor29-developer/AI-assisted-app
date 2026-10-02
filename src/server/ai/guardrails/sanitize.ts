export interface SanitizeResult {
  readonly text: string;
  readonly removed: {
    readonly tagCharacters: number;
    readonly bidiControls: number;
    readonly invisible: number;
    readonly controls: number;
  };
}

// Unicode "tag" characters render as nothing but can carry a hidden instruction for an LLM.
const TAG_CHARACTERS = /[\u{E0000}-\u{E007F}]/gu;
const BIDI_CONTROLS = /[‎‏؜‪-‮⁦-⁩]/g;
// Zero-width joiners (U+200C/D) are kept on purpose: Persian, Indic scripts and emoji need them.
const INVISIBLE = /[­᠎​⁠-⁤﻿]/g;
// Everything below U+0020 except tab and newline, DEL, and the C1 range. NUL cannot be stored in Postgres.
const CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

function strip(text: string, pattern: RegExp): { text: string; count: number } {
  let count = 0;
  const stripped = text.replace(pattern, () => {
    count += 1;
    return '';
  });
  return { text: stripped, count };
}

/** Makes untrusted text safe to store, embed and place in a prompt, and reports what was removed. */
export function sanitizeText(input: string): SanitizeResult {
  const normalizedNewlines = input.toWellFormed().replace(/\r\n?/g, '\n');
  const tags = strip(normalizedNewlines, TAG_CHARACTERS);
  const bidi = strip(tags.text, BIDI_CONTROLS);
  const invisible = strip(bidi.text, INVISIBLE);
  const controls = strip(invisible.text, CONTROLS);

  return {
    text: controls.text.normalize('NFC'),
    removed: {
      tagCharacters: tags.count,
      bidiControls: bidi.count,
      invisible: invisible.count,
      controls: controls.count,
    },
  };
}
