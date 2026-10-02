import { messageRepositoryContract } from '@/test/contracts/messages.contract';

import { InMemoryMessageRepository } from './message-repository';

messageRepositoryContract('InMemoryMessageRepository', async () => ({
  messages: new InMemoryMessageRepository(),
  userA: crypto.randomUUID(),
  userB: crypto.randomUUID(),
  documentA: crypto.randomUUID(),
  cleanup: async () => {},
}));
