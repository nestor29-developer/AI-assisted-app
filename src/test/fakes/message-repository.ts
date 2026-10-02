import type {
  Feedback,
  MessageRecord,
  MessageRepository,
  NewMessage,
} from '@/server/modules/chat/message.repository';

export class InMemoryMessageRepository implements MessageRepository {
  private readonly rows: MessageRecord[] = [];
  private tick = 0;

  async create(input: NewMessage): Promise<MessageRecord> {
    const record: MessageRecord = {
      id: crypto.randomUUID(),
      documentId: input.documentId,
      userId: input.userId,
      role: input.role,
      content: input.content,
      answer: input.answer ?? null,
      status: input.status ?? 'completed',
      errorCode: input.errorCode ?? null,
      feedback: null,
      feedbackComment: null,
      aiRequestId: input.aiRequestId ?? null,
      // A strictly increasing clock keeps insertion order stable when two inserts share a millisecond.
      createdAt: new Date(Date.now() + this.tick++ / 1000),
    };
    this.rows.push(record);
    return record;
  }

  async listByDocument(userId: string, documentId: string): Promise<MessageRecord[]> {
    return this.rows
      .filter((row) => row.userId === userId && row.documentId === documentId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async findById(userId: string, id: string): Promise<MessageRecord | null> {
    return this.rows.find((row) => row.id === id && row.userId === userId) ?? null;
  }

  async setFeedback(
    userId: string,
    id: string,
    feedback: Feedback,
    comment: string | null,
  ): Promise<MessageRecord | null> {
    const index = this.rows.findIndex(
      (row) => row.id === id && row.userId === userId && row.role === 'assistant',
    );
    if (index === -1) return null;
    const updated = { ...this.rows[index]!, feedback, feedbackComment: comment };
    this.rows[index] = updated;
    return updated;
  }
}
