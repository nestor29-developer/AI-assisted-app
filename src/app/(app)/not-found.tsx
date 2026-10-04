import type { Metadata } from 'next';

import { PageNotFound } from '@/components/ui/page-not-found';

export const metadata: Metadata = { title: 'Page not found' };

/** A page inside the signed-in shell that does not exist, like a document id that is not a UUID. */
export default function AppNotFound() {
  return <PageNotFound />;
}
