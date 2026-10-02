import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ChatView } from '@/components/chat/chat-view';

export const metadata: Metadata = { title: 'Ask about a document' };

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();

  return <ChatView documentId={id.data} />;
}
