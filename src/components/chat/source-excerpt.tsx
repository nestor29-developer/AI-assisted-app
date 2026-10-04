'use client';

import { useEffect, useRef, type ReactNode } from 'react';

type Range = readonly [start: number, end: number];

const WORD = /[\p{L}\p{N}\p{M}]+/gu;
const GAP = '[^\\p{L}\\p{N}\\p{M}]+';

/** Where each quote sits in the text, ignoring case, spacing and punctuation like the server does; merged, in order. */
export function findQuoteRanges(text: string, quotes: readonly string[]): Range[] {
  const found: Range[] = [];
  for (const quote of quotes) {
    const words = quote.match(WORD);
    if (!words) continue;
    const at = new RegExp(words.join(GAP), 'iu').exec(text);
    if (at) found.push([at.index, at.index + at[0].length]);
  }

  const merged: [number, number][] = [];
  for (const [start, end] of found.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function highlight(text: string, ranges: readonly Range[]): ReactNode[] {
  const parts: ReactNode[] = [];
  let from = 0;
  ranges.forEach(([start, end], index) => {
    if (start > from) parts.push(text.slice(from, start));
    parts.push(
      <mark key={index} className="rounded-sm bg-amber-200 text-slate-900">
        {text.slice(start, end)}
      </mark>,
    );
    from = end;
  });
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

/** The excerpt a source was cut from, with the verified quotes marked so the proof is visible. */
export function SourceExcerpt({
  text,
  quotes,
  label,
  open,
}: {
  readonly text: string;
  /** Only quotes that were verified: an unverified one has nothing to point at. */
  readonly quotes: readonly string[];
  readonly label: string;
  readonly open: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const ranges = findQuoteRanges(text, quotes);

  useEffect(() => {
    const element = box.current;
    const mark = element?.querySelector('mark');
    if (!open || !element || !mark) return;
    // Only the box scrolls: scrollIntoView would move the page as well.
    const above = mark.getBoundingClientRect().top - element.getBoundingClientRect().top;
    element.scrollTop += above - (element.clientHeight - mark.offsetHeight) / 2;
  }, [open]);

  return (
    // Focusable, so a keyboard user can scroll an excerpt that is taller than its box.
    <div
      ref={box}
      tabIndex={0}
      role="group"
      aria-label={label}
      className="mt-2 max-h-60 overflow-auto rounded-md bg-slate-50 p-3 text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-indigo-600"
    >
      {highlight(text, ranges)}
    </div>
  );
}
