import { describe, expect, it } from 'vitest';

import { makeAssistantMessage, makeUserMessage } from '@/test/fixtures/messages';

import { messageListResponseSchema } from './messages';

describe('messageListResponseSchema', () => {
  it('passes valid messages through unchanged', () => {
    const messages = [makeUserMessage(), makeAssistantMessage()];

    const parsed = messageListResponseSchema.parse({
      messages: JSON.parse(JSON.stringify(messages)),
    });

    expect(parsed.messages).toEqual(messages);
  });

  it('shows a placeholder for one message it cannot read, instead of hiding the whole thread', () => {
    const before = makeUserMessage({ content: 'First' });
    const newer = makeAssistantMessage();
    const unknownWarning = {
      ...JSON.parse(JSON.stringify(newer)),
      answer: {
        ...JSON.parse(JSON.stringify(newer.answer)),
        warnings: ['A_WARNING_FROM_THE_FUTURE'],
      },
    };

    const { messages } = messageListResponseSchema.parse({ messages: [before, unknownWarning] });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(before);
    expect(messages[1]).toMatchObject({
      id: newer.id,
      role: 'assistant',
      status: 'failed',
      content: 'This message could not be displayed.',
      answer: null,
    });
  });

  it('drops an entry that has no identity at all', () => {
    const good = makeUserMessage();

    const { messages } = messageListResponseSchema.parse({
      messages: [null, 'text', { content: 'no id' }, good],
    });

    expect(messages).toEqual([good]);
  });
});
