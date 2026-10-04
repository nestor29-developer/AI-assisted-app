'use client';

import { useCallback, useState } from 'react';

/** A polite region that is in the page before it speaks: a screen reader only announces what changes inside one. */
export function LiveStatus({ message }: { readonly message: string }) {
  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  );
}

/** The message to put in a LiveStatus, and a way to change it; saying the same thing twice still counts as a change. */
export function useAnnouncer() {
  const [message, setMessage] = useState('');
  const announce = useCallback(
    // A no-break space makes a repeated sentence a different string, so the region updates.
    (text: string) => setMessage((previous) => (previous === text ? `${text}\u{00A0}` : text)),
    [],
  );
  return { message, announce };
}
