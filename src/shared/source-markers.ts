// One or more ids in a single pair of brackets: [S1], [S1, S2], [s 3]. Gaps are bounded, so matching is linear.
const MARKER_GROUP = /\[\s{0,3}(S\s?\d{1,3}(?:\s{0,3}[,;]\s{0,3}S\s?\d{1,3}){0,7})\s{0,3}\]/gi;
const MARKER_ID = /S\s?(\d{1,3})/gi;
const MARKER_WITH_LEADING_SPACE = new RegExp(`[ \\t]{0,3}${MARKER_GROUP.source}`, 'gi');

/** Ids inside one bracket group, normalized: "S1, s 2" gives S1 and S2. */
function idsIn(group: string): string[] {
  return [...group.matchAll(MARKER_ID)].map((id) => `S${Number(id[1])}`);
}

/** The ids written into an answer, normalized: "[s1, S 2] ... [S1]" gives S1 and S2. */
export function extractSourceMarkers(text: string): string[] {
  const ids = new Set<string>();
  for (const group of text.matchAll(MARKER_GROUP)) {
    for (const id of idsIn(group[1] ?? '')) ids.add(id);
  }
  return [...ids];
}

/** Removes markers, and the space before them, from text that goes back to the model. */
export function stripSourceMarkers(text: string): string {
  return text.replace(MARKER_WITH_LEADING_SPACE, '');
}

export type AnswerSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'markers'; readonly ids: readonly string[] };

/** Splits an answer into plain text and marker groups, in order, so a UI can draw markers as chips. */
export function splitAtSourceMarkers(text: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let last = 0;
  for (const group of text.matchAll(MARKER_GROUP)) {
    const start = group.index ?? 0;
    if (start > last) segments.push({ kind: 'text', text: text.slice(last, start) });
    segments.push({ kind: 'markers', ids: idsIn(group[1] ?? '') });
    last = start + group[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}
