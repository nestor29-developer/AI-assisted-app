import { documentStoreContract } from '@/test/contracts/documents.contract';

import { InMemoryDocumentStore } from './document-store';

documentStoreContract('InMemoryDocumentStore', async () => {
  const store = new InMemoryDocumentStore();
  return {
    documents: store,
    chunks: store,
    userA: crypto.randomUUID(),
    userB: crypto.randomUUID(),
    cleanup: async () => {},
  };
});
