import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getSessionUser } from '@/app/_lib/session';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  if (await getSessionUser()) redirect('/documents');

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <p className="mb-6 text-sm font-semibold tracking-wide text-indigo-600">Document Q&amp;A</p>
      {children}
    </main>
  );
}
