import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Documents' };

export default function DocumentsPage() {
  return (
    <section className="space-y-2">
      <h1 className="text-xl font-semibold text-slate-900">Your documents</h1>
      <p className="text-sm text-slate-600">
        Uploading and asking questions arrives in the next step.
      </p>
    </section>
  );
}
