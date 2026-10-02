import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AssistantAnswer } from '@/shared/contracts/messages';
import type { MessageRepository } from '@/server/modules/chat/message.repository';

export interface MessageHarness {
  readonly messages: MessageRepository;
  readonly userA: string;
  readonly userB: string;
  /** A document owned by userA, to attach messages to. */
  readonly documentA: string;
  cleanup(): Promise<void>;
}

const answer: AssistantAnswer = {
  status: 'answered',
  answer: 'Employees accrue 1.5 days per month [S1].',
  citations: [{ sourceId: 'S1', page: 2, quote: 'accrue 1.5 vacation days', verified: true }],
  followUpQuestions: ['When do they expire?'],
  confidence: 'high',
  warnings: [],
  sources: [{ id: 'S1', page: 2, text: 'Employees accrue 1.5 vacation days per month.' }],
  meta: { model: 'mock', promptVersion: 'v1', inputTokens: 100, outputTokens: 20, latencyMs: 42 },
};

export function messageRepositoryContract(name: string, connect: () => Promise<MessageHarness>) {
  describe(`${name}: messages`, () => {
    let h: MessageHarness;
    beforeAll(async () => {
      h = await connect();
    });
    afterAll(() => h.cleanup());

    const post = (role: 'user' | 'assistant', content: string, extra = {}) =>
      h.messages.create({ documentId: h.documentA, userId: h.userA, role, content, ...extra });

    it('stores a question and a structured assistant answer and reads them back', async () => {
      const question = await post('user', 'How many days?');
      const reply = await post('assistant', answer.answer, { answer });

      expect(question).toMatchObject({
        role: 'user',
        status: 'completed',
        answer: null,
        feedback: null,
      });
      expect(reply.answer).toEqual(answer);
      expect(await h.messages.findById(h.userA, reply.id)).toEqual(reply);
    });

    it('lists a conversation oldest first', async () => {
      const first = await post('user', 'first question');
      const second = await post('assistant', 'first reply', { answer });
      const third = await post('user', 'second question');

      const ids = (await h.messages.listByDocument(h.userA, h.documentA)).map((m) => m.id);

      expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
      expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(third.id));
    });

    it('keeps failed and cancelled replies, with their error code', async () => {
      const failed = await post('assistant', '', { status: 'failed', errorCode: 'AI_UNAVAILABLE' });
      const cancelled = await post('assistant', 'partial te', { status: 'cancelled' });

      expect(failed).toMatchObject({ status: 'failed', errorCode: 'AI_UNAVAILABLE' });
      expect(cancelled).toMatchObject({ status: 'cancelled', errorCode: null });
    });

    it('hides messages from other users', async () => {
      const mine = await post('user', 'private question');

      expect(await h.messages.findById(h.userB, mine.id)).toBeNull();
      expect(await h.messages.listByDocument(h.userB, h.documentA)).toEqual([]);
    });

    it('lets the owner rate an assistant message, and replace the rating', async () => {
      const reply = await post('assistant', 'rate me', { answer });

      const down = await h.messages.setFeedback(h.userA, reply.id, 'down', 'Wrong date');
      expect(down).toMatchObject({ feedback: 'down', feedbackComment: 'Wrong date' });

      const up = await h.messages.setFeedback(h.userA, reply.id, 'up', null);
      expect(up).toMatchObject({ feedback: 'up', feedbackComment: null });
    });

    it('refuses to rate someone else’s message, a user message or an unknown one', async () => {
      const reply = await post('assistant', 'not yours to rate', { answer });
      const question = await post('user', 'a question');

      expect(await h.messages.setFeedback(h.userB, reply.id, 'up', null)).toBeNull();
      expect(await h.messages.setFeedback(h.userA, question.id, 'up', null)).toBeNull();
      expect(await h.messages.setFeedback(h.userA, crypto.randomUUID(), 'up', null)).toBeNull();
      expect((await h.messages.findById(h.userA, reply.id))?.feedback).toBeNull();
    });
  });
}
