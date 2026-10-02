import { inArray } from 'drizzle-orm';

import { users } from '@/server/core/db/schema';
import { documentStoreContract } from '@/test/contracts/documents.contract';
import { connectTestDatabase } from '@/test/helpers/database';
import { seedUser } from '@/test/helpers/seed';

import { DrizzleChunkRepository } from './chunk.repository';
import { DrizzleDocumentRepository } from './document.repository';

documentStoreContract('Drizzle (real Postgres)', async () => {
  const { db, close } = await connectTestDatabase();
  const userA = await seedUser(db);
  const userB = await seedUser(db);
  return {
    documents: new DrizzleDocumentRepository(db),
    chunks: new DrizzleChunkRepository(db),
    userA,
    userB,
    cleanup: async () => {
      await db.delete(users).where(inArray(users.id, [userA, userB]));
      await close();
    },
  };
});
