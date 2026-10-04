'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { ApiError } from '@/lib/api-client';
import { onSignedOutElsewhere } from '@/lib/auth-channel';

/** Only failures that may pass on their own (offline, 5xx) are retried; a 404 or 429 will not change. */
const shouldRetry = (failureCount: number, error: unknown) =>
  failureCount < 2 && error instanceof ApiError && (error.status === 0 || error.status >= 500);

const createClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: shouldRetry },
    },
  });

/** A session that ended while the page was open shows up as this one failure, from any request. */
const sessionEnded = (error: unknown) =>
  error instanceof ApiError && error.code === 'UNAUTHENTICATED';

export function Providers({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const [client] = useState(createClient);

  useEffect(() => {
    let left = false;
    const leave = () => {
      if (left) return;
      left = true;
      router.replace('/login');
    };

    const stopQueries = client.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') {
        if (sessionEnded(event.action.error)) leave();
      }
    });
    const stopActions = client.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') {
        if (sessionEnded(event.action.error)) leave();
      }
    });
    const stopTabs = onSignedOutElsewhere(leave);

    return () => {
      stopQueries();
      stopActions();
      stopTabs();
    };
  }, [client, router]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
