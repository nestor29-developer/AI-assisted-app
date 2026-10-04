import { splitAtSourceMarkers } from '@/shared/source-markers';

import { excerptId } from './source-ids';
import { SOURCE_TAG } from './source-tag';

const CHIP =
  'mx-0.5 align-baseline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600';

export interface SourceMarkerHandlers {
  /** Ids of the sources the answer actually came with; other markers are shown but cannot be opened. */
  readonly knownIds: ReadonlySet<string>;
  readonly openIds: ReadonlySet<string>;
  /** Keeps this answer's element ids apart from those of every other answer on the page. */
  readonly scope: string;
  readonly onToggle: (id: string) => void;
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
    <p className="max-w-[72ch] text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-slate-800">
      {splitAtSourceMarkers(text).map((segment, index) => {
        if (segment.kind === 'text') return segment.text;
        // A model may repeat an id inside one bracket pair; one chip is enough.
        return [...new Set(segment.ids)].map((id) =>
          markers?.knownIds.has(id) ? (
            <button
              key={`${index}-${id}`}
              type="button"
              onClick={() => markers.onToggle(id)}
              aria-expanded={markers.openIds.has(id)}
              aria-controls={excerptId(markers.scope, id)}
              aria-label={`Show source ${id}`}
              className={`${CHIP} ${SOURCE_TAG.known} hover:bg-indigo-100`}
            >
              {id}
            </button>
          ) : (
            <span key={`${index}-${id}`} className={`${CHIP} ${SOURCE_TAG.unknown}`}>
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
