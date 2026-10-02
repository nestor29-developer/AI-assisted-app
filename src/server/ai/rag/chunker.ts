export interface Chunk {
  readonly text: string;
  /** 1-based page for PDFs, null for plain text. */
  readonly page: number | null;
}

export interface ChunkOptions {
  readonly maxChars: number;
  readonly overlapChars: number;
}

/** Stored with each document so a future change to the algorithm can trigger a re-chunk. */
export const CHUNKER_VERSION = 'recursive-v1';
export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxChars: 1000, overlapChars: 150 };

// Coarse to fine: paragraph, line, sentence, clause, word (CJK has no spaces). Last resort is a hard cut.
const SEPARATORS = [
  '\n\n',
  '\n',
  '。',
  '！',
  '？',
  '. ',
  '? ',
  '! ',
  '；',
  '; ',
  '，',
  ', ',
  '、',
  ' ',
] as const;

function splitKeepingSeparator(text: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let at = text.indexOf(separator); at !== -1; at = text.indexOf(separator, start)) {
    const end = at + separator.length;
    parts.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}

/** Cuts at fixed width without splitting a surrogate pair (an emoji must stay whole). */
function hardSplit(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    const next = text.charCodeAt(end);
    // Step back off a pair; if that would stall (width 1), take the whole pair instead.
    if (end < text.length && next >= 0xdc00 && next <= 0xdfff)
      end = end - 1 > start ? end - 1 : end + 1;
    pieces.push(text.slice(start, end));
    start = end;
  }
  return pieces;
}

function atomize(text: string, maxChars: number, level = 0): string[] {
  if (text.length <= maxChars) return [text];
  const separator = SEPARATORS[level];
  if (separator === undefined) return hardSplit(text, maxChars);

  const parts = splitKeepingSeparator(text, separator);
  if (parts.length <= 1) return atomize(text, maxChars, level + 1);
  return parts.flatMap((part) => atomize(part, maxChars, level + 1));
}

/** The tail of the previous chunk, cut forward to a word start so overlap never begins mid-word. */
function overlapTail(text: string, overlapChars: number): string {
  if (overlapChars <= 0 || text.length === 0) return '';
  let start = Math.max(0, text.length - overlapChars);
  const code = text.charCodeAt(start);
  if (code >= 0xdc00 && code <= 0xdfff) start += 1;

  const tail = text.slice(start);
  if (start === 0) return tail;
  // Unspaced scripts (CJK) and long tokens have no word start to snap to, so keep the raw tail.
  const firstBreak = tail.search(/\s/);
  return firstBreak === -1 ? tail : tail.slice(firstBreak).trimStart();
}

function pack(atoms: readonly string[], { maxChars, overlapChars }: ChunkOptions): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const atom of atoms) {
    if (current.length + atom.length <= maxChars) {
      current += atom;
      continue;
    }
    if (current.trim()) chunks.push(current.trim());
    const carried = overlapTail(current, overlapChars);
    // The carried tail is contiguous with `atom` in the source, so no separator is added.
    current = carried.length + atom.length <= maxChars ? carried + atom : atom;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function splitText(text: string, options: ChunkOptions): string[] {
  // At least 2 UTF-16 units of room, so one surrogate pair always fits in a piece.
  if (options.maxChars - options.overlapChars < 2) {
    throw new RangeError('maxChars must exceed overlapChars by at least 2');
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  // Atoms leave room for the carried overlap, so a chunk always fits tail + next piece.
  return pack(atomize(trimmed, options.maxChars - options.overlapChars), options);
}

export function chunkText(text: string, options: ChunkOptions = DEFAULT_CHUNK_OPTIONS): Chunk[] {
  return splitText(text, options).map((chunk) => ({ text: chunk, page: null }));
}

/** Chunks each page on its own, so every chunk maps to exactly one page for citations. */
export function chunkPages(
  pages: readonly string[],
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): Chunk[] {
  return pages.flatMap((pageText, index) =>
    splitText(pageText, options).map((chunk) => ({ text: chunk, page: index + 1 })),
  );
}
