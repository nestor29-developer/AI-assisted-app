import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EMBEDDING_DIMENSIONS } from '@/server/core/constants';
import type { ChunkRepository } from '@/server/modules/documents/chunk.repository';
import type {
  DocumentRepository,
  NewChunk,
  NewDocument,
} from '@/server/modules/documents/document.repository';

export interface DocumentStoreHarness {
  readonly documents: DocumentRepository;
  readonly chunks: ChunkRepository;
  readonly userA: string;
  readonly userB: string;
  cleanup(): Promise<void>;
}

/** A unit vector along `axis`, optionally leaning toward a second axis. */
export function vector(axis: number, lean?: { axis: number; weight: number }): number[] {
  const values = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  values[axis] = 1;
  if (lean) values[lean.axis] = lean.weight;
  return values;
}

const chunk = (ordinal: number, embedding: number[], page: number | null = null): NewChunk => ({
  ordinal,
  page,
  content: `chunk ${ordinal}`,
  embedding,
});

/** Behaviour every document/chunk store must have; run against the fake and against Postgres. */
export function documentStoreContract(name: string, connect: () => Promise<DocumentStoreHarness>) {
  describe(`${name}: documents and chunks`, () => {
    let h: DocumentStoreHarness;

    const newDocument = (userId: string, title = 'Handbook'): NewDocument => ({
      userId,
      title,
      sourceType: 'file',
      mimeType: 'application/pdf',
      sizeBytes: 1234,
      pageCount: 7,
      content: 'full extracted text',
      tokenEstimate: 5,
      embeddingModel: 'test-embedding',
      chunkerVersion: 'recursive-v1',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    beforeAll(async () => {
      h = await connect();
    });
    afterAll(() => h.cleanup());

    it('stores a document with its chunks and reads it back for the owner', async () => {
      const created = await h.documents.createWithChunks(newDocument(h.userA), [
        chunk(0, vector(0), 1),
        chunk(1, vector(1), 2),
      ]);

      expect(created).toMatchObject({
        userId: h.userA,
        title: 'Handbook',
        chunkCount: 2,
        pageCount: 7,
      });
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      const { content, ...summary } = created;
      expect(content).toBe('full extracted text');
      expect(await h.documents.findById(h.userA, created.id)).toEqual(summary);
    });

    it('hides a document from other users and for unknown ids (isolation by owner)', async () => {
      const created = await h.documents.createWithChunks(newDocument(h.userA), [
        chunk(0, vector(0)),
      ]);

      expect(await h.documents.findById(h.userB, created.id)).toBeNull();
      expect(await h.documents.findById(h.userA, crypto.randomUUID())).toBeNull();
    });

    it('stops returning a document once it has expired, even before the purge has removed it', async () => {
      const expired = await h.documents.createWithChunks(
        { ...newDocument(h.userA, 'expired'), expiresAt: new Date(Date.now() - 1_000) },
        [chunk(0, vector(0))],
      );
      const live = await h.documents.createWithChunks(newDocument(h.userA, 'still live'), [
        chunk(0, vector(0)),
      ]);

      expect(await h.documents.findById(h.userA, expired.id)).toBeNull();
      expect(await h.documents.findById(h.userA, live.id)).not.toBeNull();
      const ids = (await h.documents.listByUser(h.userA)).map((d) => d.id);
      expect(ids).toContain(live.id);
      expect(ids).not.toContain(expired.id);
    });

    it('lists only the owner’s documents, newest first, without the extracted text', async () => {
      const first = await h.documents.createWithChunks(newDocument(h.userA, 'older'), [
        chunk(0, vector(0)),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await h.documents.createWithChunks(newDocument(h.userA, 'newer'), [
        chunk(0, vector(0)),
      ]);
      await h.documents.createWithChunks(newDocument(h.userB, 'not yours'), [chunk(0, vector(0))]);

      const list = await h.documents.listByUser(h.userA);
      const ids = list.map((d) => d.id);

      expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
      expect(list.every((d) => d.userId === h.userA)).toBe(true);
      expect(list[0]).not.toHaveProperty('content');
    });

    it('deletes for the owner only, and takes the chunks with it', async () => {
      const created = await h.documents.createWithChunks(newDocument(h.userA), [
        chunk(0, vector(0)),
      ]);

      expect(await h.documents.delete(h.userB, created.id)).toBe(false);
      expect(await h.documents.findById(h.userA, created.id)).not.toBeNull();

      expect(await h.documents.delete(h.userA, created.id)).toBe(true);
      expect(await h.documents.findById(h.userA, created.id)).toBeNull();
      expect(await h.chunks.listByDocument(h.userA, created.id)).toEqual([]);
      expect(await h.documents.delete(h.userA, created.id)).toBe(false);
    });

    it('lists chunks in document order, and nothing for a non-owner', async () => {
      const created = await h.documents.createWithChunks(newDocument(h.userA), [
        chunk(2, vector(2), 3),
        chunk(0, vector(0), 1),
        chunk(1, vector(1), 2),
      ]);

      const own = await h.chunks.listByDocument(h.userA, created.id);

      expect(own.map((c) => [c.ordinal, c.page])).toEqual([
        [0, 1],
        [1, 2],
        [2, 3],
      ]);
      expect(await h.chunks.listByDocument(h.userB, created.id)).toEqual([]);
    });

    it('ranks chunks by cosine similarity and honours the limit', async () => {
      const created = await h.documents.createWithChunks(newDocument(h.userA), [
        chunk(0, vector(1)),
        chunk(1, vector(0)),
        chunk(2, vector(0, { axis: 1, weight: 0.3 })),
      ]);

      const results = await h.chunks.searchSimilar(h.userA, created.id, vector(0), 2);

      expect(results.map((r) => r.ordinal)).toEqual([1, 2]);
      expect(results[0]!.score).toBeCloseTo(1, 5);
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
      expect(results.every((r) => r.score >= 0 && r.score <= 1.000001)).toBe(true);
    });

    it("never returns another user's chunks from a similarity search", async () => {
      const created = await h.documents.createWithChunks(newDocument(h.userA), [
        chunk(0, vector(0)),
      ]);

      expect(await h.chunks.searchSimilar(h.userB, created.id, vector(0), 5)).toEqual([]);
      expect(await h.chunks.searchSimilar(h.userA, crypto.randomUUID(), vector(0), 5)).toEqual([]);
    });

    it('stores nothing when a chunk is invalid (all or nothing)', async () => {
      const before = (await h.documents.listByUser(h.userA)).length;

      await expect(
        h.documents.createWithChunks(newDocument(h.userA, 'broken'), [
          chunk(0, vector(0)),
          chunk(0, vector(1)),
        ]),
      ).rejects.toThrow();
      await expect(
        h.documents.createWithChunks(newDocument(h.userA, 'wrong size'), [chunk(0, [1, 2, 3])]),
      ).rejects.toThrow();

      expect((await h.documents.listByUser(h.userA)).length).toBe(before);
    });
  });
}
