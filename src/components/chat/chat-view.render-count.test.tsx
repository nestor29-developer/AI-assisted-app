import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { stubApi } from '@/test/helpers/api';
import { ask, chatRoutes } from '@/test/helpers/chat';
import { renderWithClient } from '@/test/helpers/render';
import { controlledSse } from '@/test/helpers/sse';
import { makeAssistantMessage, makeDocument, makeUserMessage } from '@/test/fixtures/messages';

import { AnswerCard } from './answer-card';
import { ChatView } from './chat-view';

vi.mock('./answer-card', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./answer-card')>();
  return { ...actual, AnswerCard: vi.fn(actual.AnswerCard) };
});

const document = makeDocument({ title: 'Employee handbook' });
const ASK = `POST /api/v1/documents/${document.id}/messages`;

describe('ChatView: while an answer streams in', () => {
  it('does not draw the stored answers again for every word that arrives', async () => {
    const user = userEvent.setup();
    const stored = Array.from({ length: 4 }, () => [
      makeUserMessage(),
      makeAssistantMessage(),
    ]).flat();
    let stream!: ReturnType<typeof controlledSse>;
    stubApi({
      ...chatRoutes(document, stored),
      [ASK]: (call) => {
        stream = controlledSse(call.signal);
        return stream.response;
      },
    });
    renderWithClient(<ChatView documentId={document.id} />);
    await screen.findAllByRole('article');

    await ask(user, 'And what about sick leave?');
    stream.push({ type: 'accepted', userMessage: makeUserMessage({ content: 'Sick?' }) });
    stream.push({ type: 'delta', text: 'First ' });
    await screen.findByText(/First/);
    const before = vi.mocked(AnswerCard).mock.calls.length;

    for (let word = 0; word < 25; word += 1) stream.push({ type: 'delta', text: `word${word} ` });
    await screen.findByText(/word24/);

    expect(vi.mocked(AnswerCard).mock.calls.length).toBe(before);
  });
});
