'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LiveStatus, useAnnouncer } from '@/components/ui/live-status';
import { Skeleton } from '@/components/ui/skeleton';
import { useDeleteDocument, useDocuments } from '@/hooks/use-documents';
import { describeError } from '@/lib/api-errors';
import { describeKind, formatBytes, formatExpiry } from '@/lib/format';
import type { DocumentSummary } from '@/shared/contracts/documents';

function DocumentRow({
  document,
  onRemoved,
}: {
  readonly document: DocumentSummary;
  /** Told when the delete went through; `focusLost` says nobody has moved focus elsewhere since. */
  readonly onRemoved: (title: string, focusLost: boolean) => void;
}) {
  const remove = useDeleteDocument();
  const [confirming, setConfirming] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  // The safe choice is focused first, and closing the question hands focus back to the button that opened it.
  useEffect(() => {
    if (confirming) {
      cancelRef.current?.focus();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      deleteRef.current?.focus();
    }
  }, [confirming]);

  function closeConfirmation() {
    restoreFocus.current = true;
    setConfirming(false);
  }

  async function confirmDelete() {
    try {
      await remove.mutateAsync(document.id);
    } catch {
      closeConfirmation();
      return;
    }
    // By now the row is usually gone and focus with it; if the person moved on, leave them there.
    const active = window.document.activeElement;
    const focusLost =
      !active || active === window.document.body || Boolean(rowRef.current?.contains(active));
    onRemoved(document.title, focusLost);
  }

  return (
    <li ref={rowRef} className="space-y-2 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <Link
            href={`/documents/${document.id}`}
            className="line-clamp-2 text-sm font-medium wrap-break-word text-indigo-700 hover:underline"
          >
            {document.title}
          </Link>
          <p className="text-xs text-slate-600">
            {describeKind(document)} · {formatBytes(document.sizeBytes)} · {document.chunkCount}{' '}
            {document.chunkCount === 1 ? 'section' : 'sections'} ·{' '}
            {formatExpiry(document.expiresAt)}
          </p>
        </div>
        {confirming ? null : (
          <Button
            ref={deleteRef}
            variant="secondary"
            size="sm"
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${document.title}`}
          >
            Delete
          </Button>
        )}
      </div>
      {confirming ? (
        <div role="group" aria-label="Confirm delete" className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-slate-700">Delete this document and its conversation?</p>
          <Button
            variant="danger"
            size="sm"
            loading={remove.isPending}
            onClick={() => void confirmDelete()}
          >
            Yes, delete
          </Button>
          <Button
            ref={cancelRef}
            variant="secondary"
            size="sm"
            disabled={remove.isPending}
            onClick={closeConfirmation}
          >
            Cancel
          </Button>
        </div>
      ) : null}
      {remove.isError ? <Alert tone="error">{describeError(remove.error)}</Alert> : null}
    </li>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading your documents" className="space-y-3">
      <span className="sr-only">Loading your documents…</span>
      {[0, 1, 2].map((row) => (
        <div key={row} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function DocumentList() {
  const documents = useDocuments();
  const heading = useRef<HTMLHeadingElement>(null);
  const { message, announce } = useAnnouncer();

  function onRemoved(title: string, focusLost: boolean) {
    announce(`${title} was deleted.`);
    if (focusLost) heading.current?.focus();
  }

  return (
    <section aria-labelledby="documents-heading" className="space-y-3">
      <LiveStatus message={message} />
      <h2
        ref={heading}
        id="documents-heading"
        tabIndex={-1}
        className="rounded-sm text-base font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600"
      >
        Your documents
      </h2>
      {documents.isPending ? <ListSkeleton /> : null}
      {documents.isError ? (
        <div className="space-y-3">
          <Alert tone="error">{describeError(documents.error)}</Alert>
          <Button variant="secondary" onClick={() => void documents.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {documents.isSuccess && documents.data.length === 0 ? (
        <EmptyState
          title="No documents yet"
          description="Add some text or upload a file above, and it will show up here."
        />
      ) : null}
      {documents.isSuccess && documents.data.length > 0 ? (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {documents.data.map((document) => (
            <DocumentRow key={document.id} document={document} onRemoved={onRemoved} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
