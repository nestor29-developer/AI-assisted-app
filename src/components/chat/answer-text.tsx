import { splitAtSourceMarkers } from '@/shared/source-markers';

const CHIP =
  'mx-0.5 inline-flex items-center rounded px-1 text-xs font-medium align-baseline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600';

export interface SourceMarkerHandlers {
  /** Ids of the sources the answer actually came with; other markers are shown but cannot be opened. */
  readonly knownIds: ReadonlySet<string>;
  readonly openIds: ReadonlySet<string>;
  readonly onSelect: (id: string) => void;
}

/** Answers are plain text: React escapes everything, and [S1] markers become small buttons. */
export function AnswerText({
  text,
  markers,
  cursor = false,
}: {
  readonly text: string;
  /** Left out while the answer is still being written, when no source can be opened yet. */
  readonly markers?: SourceMarkerHandlers;
  /** A blinking caret at the end of the text, for an answer that is still arriving. */
  readonly cursor?: boolean;
}) {
  return (
    <p className="text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-slate-800">
      {splitAtSourceMarkers(text).map((segment, index) => {
        if (segment.kind === 'text') return segment.text;
        return segment.ids.map((id) =>
          markers?.knownIds.has(id) ? (
            <button
              key={`${index}-${id}`}
              type="button"
              onClick={() => markers.onSelect(id)}
              aria-expanded={markers.openIds.has(id)}
              aria-controls={`source-${id}`}
              aria-label={`Show source ${id}`}
              className={`${CHIP} bg-indigo-50 text-indigo-700 hover:bg-indigo-100`}
            >
              {id}
            </button>
          ) : (
            <span key={`${index}-${id}`} className={`${CHIP} bg-slate-100 text-slate-600`}>
              {id}
            </span>
          ),
        );
      })}
      {cursor ? (
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 bg-indigo-600 motion-safe:animate-pulse"
        />
      ) : null}
    </p>
  );
}
