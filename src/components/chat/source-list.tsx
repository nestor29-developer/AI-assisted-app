import { Badge } from '@/components/ui/badge';
import type { AssistantAnswer } from '@/shared/contracts/messages';

type Citation = AssistantAnswer['citations'][number];

interface SourceListProps {
  readonly citations: readonly Citation[];
  readonly sources: AssistantAnswer['sources'];
  /** Source ids the answer text points at, so a marker without a quote still gets a row. */
  readonly markedIds: readonly string[];
  readonly openIds: ReadonlySet<string>;
  readonly onToggle: (id: string, open: boolean) => void;
}

function rowIds(citations: readonly Citation[], markedIds: readonly string[]): string[] {
  return [...new Set([...citations.map((citation) => citation.sourceId), ...markedIds])];
}

export function SourceList({ citations, sources, markedIds, openIds, onToggle }: SourceListProps) {
  const ids = rowIds(citations, markedIds);
  if (ids.length === 0) return null;

  return (
    <section aria-label="Sources" className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-900">Sources</h2>
      <ul className="space-y-2">
        {ids.map((id) => {
          const quotes = citations.filter((citation) => citation.sourceId === id);
          const source = sources.find((candidate) => candidate.id === id);
          const page = quotes.find((quote) => quote.page !== null)?.page ?? source?.page ?? null;

          return (
            <li
              key={id}
              id={`source-${id}`}
              className="space-y-2 rounded-lg border border-slate-200 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{id}</Badge>
                {page === null ? null : <span className="text-xs text-slate-600">Page {page}</span>}
              </div>
              {quotes.map((quote) => (
                <figure key={quote.quote} className="space-y-1.5">
                  <blockquote className="border-l-2 border-slate-300 pl-3 text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-slate-800">
                    “{quote.quote}”
                  </blockquote>
                  <figcaption>
                    <Badge tone={quote.verified ? 'success' : 'warning'}>
                      <span aria-hidden="true">{quote.verified ? '✓' : '⚠'}</span>
                      {quote.verified
                        ? 'Quote found in the document'
                        : 'Quote not found in the document'}
                    </Badge>
                  </figcaption>
                </figure>
              ))}
              {quotes.length === 0 ? (
                <p className="text-xs text-slate-600">The answer points here without quoting it.</p>
              ) : null}
              {source ? (
                <details
                  open={openIds.has(id)}
                  onToggle={(event) => onToggle(id, event.currentTarget.open)}
                >
                  <summary className="cursor-pointer text-sm font-medium text-indigo-700 hover:underline">
                    Source excerpt
                  </summary>
                  {/* Focusable, so a keyboard user can scroll an excerpt that is taller than its box. */}
                  <div
                    tabIndex={0}
                    role="region"
                    aria-label={`Text of source ${id}`}
                    className="mt-2 max-h-60 overflow-auto rounded-md bg-slate-50 p-3 text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-indigo-600"
                  >
                    {source.text}
                  </div>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
