import type { Metadata } from 'next';

import { PageNotFound } from '@/components/ui/page-not-found';

export const metadata: Metadata = { title: 'Page not found' };

/** An address no page answers to: outside the signed-in shell, so it carries its own `main`. */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <PageNotFound />
    </main>
  );
}
