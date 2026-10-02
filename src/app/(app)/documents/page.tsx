import type { Metadata } from 'next';

import { DocumentList } from '@/components/documents/document-list';
import { NewDocumentForm } from '@/components/documents/new-document-form';

export const metadata: Metadata = { title: 'Documents' };

export default function DocumentsPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-slate-900">Documents</h1>
      <NewDocumentForm />
      <DocumentList />
    </div>
  );
}
