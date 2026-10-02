const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** Cuts to at most `maxUnits` UTF-16 units, never leaving half of a surrogate pair behind. */
export function truncate(text: string, maxUnits: number): string {
  if (text.length <= maxUnits) return text;
  const end = isHighSurrogate(text.charCodeAt(maxUnits - 1)) ? maxUnits - 1 : maxUnits;
  return text.slice(0, Math.max(end, 0));
}

/** Cuts at a fixed width without splitting a surrogate pair (an emoji must stay whole). */
export function splitAtWidth(text: string, width: number): string[] {
  if (!Number.isInteger(width) || width < 1)
    throw new RangeError('width must be a positive integer');
  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + width, text.length);
    // Step back off a pair; if that would stall (width 1), take the whole pair instead.
    if (end < text.length && isLowSurrogate(text.charCodeAt(end)))
      end = end - 1 > start ? end - 1 : end + 1;
    pieces.push(text.slice(start, end));
    start = end;
  }
  return pieces;
}
