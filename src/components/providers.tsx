'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { ApiError } from '@/lib/api-client';

/** Only failures that may pass on their own (offline, 5xx) are retried; a 404 or 429 will not change. */
const shouldRetry = (failureCount: number, error: unknown) =>
  failureCount < 2 && error instanceof ApiError && (error.status === 0 || error.status >= 500);

export function Providers({ children }: { readonly children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: shouldRetry },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
