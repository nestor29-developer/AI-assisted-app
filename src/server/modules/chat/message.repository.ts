import { and, asc, eq } from 'drizzle-orm';

import type { Database } from '@/server/core/db/client';
import { messages } from '@/server/core/db/schema';
import { assistantAnswerSchema, type AssistantAnswer } from '@/shared/contracts/messages';

export type MessageRole = 'user' | 'assistant';
export type MessageStatus = 'completed' | 'failed' | 'cancelled';
export type Feedback = 'up' | 'down';

export interface MessageRecord {
  readonly id: string;
  readonly documentId: string;
  readonly userId: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly answer: AssistantAnswer | null;
  readonly status: MessageStatus;
  readonly errorCode: string | null;
  readonly feedback: Feedback | null;
  readonly feedbackComment: string | null;
  readonly aiRequestId: string | null;
  readonly createdAt: Date;
}

export interface NewMessage {
  readonly documentId: string;
  readonly userId: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly answer?: AssistantAnswer | null;
  readonly status?: MessageStatus;
  readonly errorCode?: string | null;
  readonly aiRequestId?: string | null;
}

export interface MessageRepository {
  create(input: NewMessage): Promise<MessageRecord>;
  /** Oldest first, which is the order a conversation reads in. */
  listByDocument(userId: string, documentId: string): Promise<MessageRecord[]>;
  findById(userId: string, id: string): Promise<MessageRecord | null>;
  /** Only assistant messages can be rated; null when missing, not yours, or a user message. */
  setFeedback(
    userId: string,
    id: string,
    feedback: Feedback,
    comment: string | null,
  ): Promise<MessageRecord | null>;
}

type MessageRow = typeof messages.$inferSelect;

function toRecord(row: MessageRow): MessageRecord {
  // An answer stored under an older schema should degrade to "no structured answer", not crash a list.
  const parsed = assistantAnswerSchema.safeParse(row.answer);
  return { ...row, answer: parsed.success ? parsed.data : null };
}

export class DrizzleMessageRepository implements MessageRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewMessage): Promise<MessageRecord> {
    const [row] = await this.db
      .insert(messages)
      .values({
        documentId: input.documentId,
        userId: input.userId,
        role: input.role,
        content: input.content,
        answer: input.answer ?? null,
        status: input.status ?? 'completed',
        errorCode: input.errorCode ?? null,
        aiRequestId: input.aiRequestId ?? null,
      })
      .returning();
    if (!row) throw new Error('Insert into messages returned no row');
    return toRecord(row);
  }

  async listByDocument(userId: string, documentId: string): Promise<MessageRecord[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.documentId, documentId), eq(messages.userId, userId)))
      .orderBy(asc(messages.createdAt));
    return rows.map(toRecord);
  }

  async findById(userId: string, id: string): Promise<MessageRecord | null> {
    const [row] = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.id, id), eq(messages.userId, userId)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async setFeedback(
    userId: string,
    id: string,
    feedback: Feedback,
    comment: string | null,
  ): Promise<MessageRecord | null> {
    const [row] = await this.db
      .update(messages)
      .set({ feedback, feedbackComment: comment })
      .where(and(eq(messages.id, id), eq(messages.userId, userId), eq(messages.role, 'assistant')))
      .returning();
    return row ? toRecord(row) : null;
  }
}
