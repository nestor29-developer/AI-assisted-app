import { Badge } from '@/components/ui/badge';
import { CARD_TITLE } from '@/components/ui/card-title';
import type { AssistantAnswer } from '@/shared/contracts/messages';

import { excerptId, sourceRowId } from './source-ids';
import { SourceExcerpt } from './source-excerpt';
import { SOURCE_TAG } from './source-tag';

type Citation = AssistantAnswer['citations'][number];

interface SourceListProps {
  /** Keeps this answer's element ids apart from those of every other answer on the page. */
  readonly scope: string;
  readonly citations: readonly Citation[];
  readonly sources: AssistantAnswer['sources'];
  /** Source ids the answer text points at, so a marker without a quote still gets a row. */
  readonly markedIds: readonly string[];
  readonly openIds: ReadonlySet<string>;
  readonly onOpenChange: (id: string, open: boolean) => void;
}

function rowIds(citations: readonly Citation[], markedIds: readonly string[]): string[] {
  return [...new Set([...citations.map((citation) => citation.sourceId), ...markedIds])];
}

export function SourceList({
  scope,
  citations,
  sources,
  markedIds,
  openIds,
  onOpenChange,
}: SourceListProps) {
  const ids = rowIds(citations, markedIds);
  if (ids.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className={`${CARD_TITLE} text-slate-900`}>Sources</h2>
      <ul className="space-y-2">
        {ids.map((id) => {
          const quotes = citations.filter((citation) => citation.sourceId === id);
          const source = sources.find((candidate) => candidate.id === id);
          const page = quotes.find((quote) => quote.page !== null)?.page ?? source?.page ?? null;
          const open = openIds.has(id);

          return (
            <li
              key={id}
              id={sourceRowId(scope, id)}
              className="space-y-2 rounded-lg border border-slate-200 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={source ? SOURCE_TAG.known : SOURCE_TAG.unknown}>{id}</span>
                {page === null ? null : <span className="text-xs text-slate-600">Page {page}</span>}
              </div>
              {quotes.map((quote, index) => (
                <figure key={`${index}-${quote.quote}`} className="space-y-1.5">
                  <blockquote className="max-w-[72ch] border-l-2 border-slate-300 pl-3 text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-slate-800">
                    {quote.quote}
                  </blockquote>
                  <figcaption>
                    <Badge tone={quote.verified ? 'success' : 'warning'}>
                      <span aria-hidden="true">{quote.verified ? '✓' : '⚠'}</span>
                      {quote.verified
                        ? 'Quote found in the document'
                        : 'Quote not found in the cited excerpt'}
                    </Badge>
                  </figcaption>
                </figure>
              ))}
              {quotes.length === 0 ? (
                <p className="text-xs text-slate-600">The answer points here without quoting it.</p>
              ) : null}
              {source ? (
                <details
                  id={excerptId(scope, id)}
                  open={open}
                  onToggle={(event) => onOpenChange(id, event.currentTarget.open)}
                >
                  <summary className="text-sm font-medium text-indigo-700 hover:underline">
                    Source excerpt {id}
                  </summary>
                  <SourceExcerpt
                    text={source.text}
                    quotes={quotes.filter((quote) => quote.verified).map((quote) => quote.quote)}
                    label={`Text of source ${id}`}
                    open={open}
                  />
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
