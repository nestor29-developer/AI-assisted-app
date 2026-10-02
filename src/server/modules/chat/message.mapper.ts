import type { MessageDto } from '@/shared/contracts/messages';

import type { MessageRecord } from './message.repository';

export function toMessageDto(record: MessageRecord): MessageDto {
  return {
    id: record.id,
    role: record.role,
    content: record.content,
    answer: record.answer,
    status: record.status,
    errorCode: record.errorCode,
    feedback: record.feedback,
    createdAt: record.createdAt.toISOString(),
  };
}
