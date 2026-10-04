'use client';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/** A page threw while rendering; the header stays, and the person can try the page again. */
export default function AppError({
  retry,
}: {
  readonly error: Error & { digest?: string };
  readonly retry: () => void;
}) {
  return (
    <div role="alert">
      <EmptyState
        titleAs="h1"
        title="Something went wrong"
        description="This page ran into a problem. Trying again often fixes it."
      >
        <Button onClick={retry}>Try again</Button>
      </EmptyState>
    </div>
  );
}
