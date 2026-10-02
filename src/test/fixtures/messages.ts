import type { DocumentSummary } from '@/shared/contracts/documents';
import type { AssistantAnswer, MessageDto } from '@/shared/contracts/messages';

const NOW = '2026-10-01T12:00:00.000Z';
let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

export function makeDocument(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: uuid(),
    title: 'Employee handbook',
    sourceType: 'file',
    mimeType: 'text/markdown',
    sizeBytes: 48_000,
    pageCount: null,
    chunkCount: 4,
    createdAt: NOW,
    expiresAt: '2026-10-31T12:00:00.000Z',
    ...overrides,
  };
}

export function makeAnswer(overrides: Partial<AssistantAnswer> = {}): AssistantAnswer {
  return {
    status: 'answered',
    answer: 'Employees accrue 1.5 vacation days per month [S1].',
    citations: [
      {
        sourceId: 'S1',
        page: 2,
        quote: 'Employees accrue 1.5 vacation days per month.',
        verified: true,
      },
    ],
    followUpQuestions: ['When do unused days expire?'],
    confidence: 'high',
    warnings: [],
    sources: [{ id: 'S1', page: 2, text: 'Employees accrue 1.5 vacation days per month.' }],
    meta: {
      model: 'gemini-3.8-flash',
      promptVersion: 'v1',
      inputTokens: 1200,
      outputTokens: 80,
      latencyMs: 1500,
    },
    ...overrides,
  };
}

export function makeUserMessage(overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id: uuid(),
    role: 'user',
    content: 'How many vacation days do I get?',
    answer: null,
    status: 'completed',
    errorCode: null,
    feedback: null,
    createdAt: NOW,
    ...overrides,
  };
}

export function makeAssistantMessage(overrides: Partial<MessageDto> = {}): MessageDto {
  const answer = overrides.answer === undefined ? makeAnswer() : overrides.answer;
  return {
    id: uuid(),
    role: 'assistant',
    content: answer?.answer ?? '',
    answer,
    status: 'completed',
    errorCode: null,
    feedback: null,
    createdAt: NOW,
    ...overrides,
  };
}
