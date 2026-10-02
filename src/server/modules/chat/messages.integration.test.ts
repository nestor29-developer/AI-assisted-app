import { inArray } from 'drizzle-orm';

import { users } from '@/server/core/db/schema';
import { messageRepositoryContract } from '@/test/contracts/messages.contract';
import { connectTestDatabase } from '@/test/helpers/database';
import { seedDocument, seedUser } from '@/test/helpers/seed';

import { DrizzleMessageRepository } from './message.repository';

messageRepositoryContract('Drizzle (real Postgres)', async () => {
  const { db, close } = await connectTestDatabase();
  const userA = await seedUser(db);
  const userB = await seedUser(db);
  const documentA = await seedDocument(db, userA);
  return {
    messages: new DrizzleMessageRepository(db),
    userA,
    userB,
    documentA,
    cleanup: async () => {
      await db.delete(users).where(inArray(users.id, [userA, userB]));
      await close();
    },
  };
});
