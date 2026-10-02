// One or more ids in a single pair of brackets: [S1], [S1, S2], [s 3]. Gaps are bounded, so matching is linear.
const MARKER_GROUP = /\[\s{0,3}(S\s?\d{1,3}(?:\s{0,3}[,;]\s{0,3}S\s?\d{1,3}){0,7})\s{0,3}\]/gi;
const MARKER_ID = /S\s?(\d{1,3})/gi;
const MARKER_WITH_LEADING_SPACE = new RegExp(`[ \\t]{0,3}${MARKER_GROUP.source}`, 'gi');

/** The ids written into an answer, normalized: "[s1, S 2] ... [S1]" gives S1 and S2. */
export function extractSourceMarkers(text: string): string[] {
  const ids = new Set<string>();
  for (const group of text.matchAll(MARKER_GROUP)) {
    for (const id of (group[1] ?? '').matchAll(MARKER_ID)) ids.add(`S${Number(id[1])}`);
  }
  return [...ids];
}

/** Removes markers, and the space before them, from text that goes back to the model. */
export function stripSourceMarkers(text: string): string {
  return text.replace(MARKER_WITH_LEADING_SPACE, '');
}
