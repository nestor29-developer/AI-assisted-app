import { randomUUID } from 'node:crypto';

import type { Database } from '@/server/core/db/client';
import { documents, users } from '@/server/core/db/schema';

/** Inserts a throwaway user; delete it afterwards and everything it owns cascades away. */
export async function seedUser(db: Database): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email: `seed-${randomUUID()}@example.com`, passwordHash: 'x' })
    .returning({ id: users.id });
  return user!.id;
}

export async function seedDocument(db: Database, userId: string): Promise<string> {
  const [document] = await db
    .insert(documents)
    .values({
      userId,
      title: 'Seed document',
      sourceType: 'text',
      mimeType: 'text/plain',
      sizeBytes: 10,
      content: 'content',
      tokenEstimate: 3,
      chunkCount: 1,
      embeddingModel: 'test',
      chunkerVersion: 'v1',
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning({ id: documents.id });
  return document!.id;
}
