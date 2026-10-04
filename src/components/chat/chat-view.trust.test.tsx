import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { MessageDto } from '@/shared/contracts/messages';
import { json, stubApi } from '@/test/helpers/api';
import { ask, chatRoutes, composer, pressStop } from '@/test/helpers/chat';
import { renderWithClient } from '@/test/helpers/render';
import { controlledSse, sseResponse } from '@/test/helpers/sse';
import {
  makeAnswer,
  makeAssistantMessage,
  makeDocument,
  makeUserMessage,
} from '@/test/fixtures/messages';

import { ChatView } from './chat-view';
import { STARTER_QUESTIONS } from './starter-questions';

const document = makeDocument({ title: 'Employee handbook' });
const DOC = `/api/v1/documents/${document.id}`;
const ASK = `POST ${DOC}/messages`;
const THREAD = `GET ${DOC}/messages`;
const QUESTION = 'How many vacation days do I get?';

const render = () => renderWithClient(<ChatView documentId={document.id} />);
const stored = (answer: ReturnType<typeof makeAnswer>) => [
  makeUserMessage({ content: QUESTION }),
  makeAssistantMessage({ answer }),
];
const verified = (quote: string) => ({ sourceId: 'S1', page: 1, quote, verified: true });

describe('ChatView: what the badges claim', () => {
  it('shows only "Partial answer" when it is partial and every quote was verified', async () => {
    stubApi(
      chatRoutes(
        document,
        stored(makeAnswer({ status: 'partially_answered', confidence: 'medium' })),
      ),
    );

    render();

    const answer = await screen.findByRole('article');
    expect(within(answer).getByText('Partial answer')).toBeInTheDocument();
    expect(within(answer).queryByText('Partly verified')).not.toBeInTheDocument();
    expect(within(answer).queryByText('Unverified, double-check')).not.toBeInTheDocument();
  });

  it('shows both when a quote of a partial answer was not verified', async () => {
    stubApi(
      chatRoutes(
        document,
        stored(
          makeAnswer({
            status: 'partially_answered',
            confidence: 'medium',
            citations: [
              verified('Employees accrue 1.5 vacation days per month.'),
              { ...verified('Invented words that appear nowhere'), verified: false },
            ],
          }),
        ),
      ),
    );

    render();

    const answer = await screen.findByRole('article');
    expect(within(answer).getByText('Partial answer')).toBeInTheDocument();
    expect(within(answer).getByText('Partly verified')).toBeInTheDocument();
  });

  it('says "Quotes verified", with what that does and does not mean one hover away', async () => {
    stubApi(chatRoutes(document, stored(makeAnswer())));

    render();

    const label = await screen.findByText('Quotes verified');
    expect(label.closest('[title]')).toHaveAttribute(
      'title',
      expect.stringMatching(/not that the answer is right/),
    );
    expect(screen.queryByText('Grounded in the document')).not.toBeInTheDocument();
  });

  it('says only the cited excerpt was searched when a quote is not found', async () => {
    stubApi(
      chatRoutes(
        document,
        stored(
          makeAnswer({
            confidence: 'low',
            citations: [{ ...verified('Invented words that appear nowhere'), verified: false }],
          }),
        ),
      ),
    );

    render();

    expect(await screen.findByText('Quote not found in the cited excerpt')).toBeInTheDocument();
    expect(screen.queryByText(/not found in the document/i)).not.toBeInTheDocument();
  });
});

describe('ChatView: the excerpt shows the proof', () => {
  const excerpt = 'Intro line.\nEmployees accrue 1.5 vacation days per month.\nOther rules follow.';

  it('marks the verified quote inside the excerpt, however the source spells it', async () => {
    const user = userEvent.setup();
    stubApi(
      chatRoutes(
        document,
        stored(
          makeAnswer({
            citations: [verified('EMPLOYEES  accrue 1.5 vacation days')],
            sources: [{ id: 'S1', page: 1, text: excerpt }],
          }),
        ),
      ),
    );
    render();
    const answer = await screen.findByRole('article');

    await user.click(within(answer).getByRole('button', { name: 'Show source S1' }));

    const group = within(answer).getByRole('group', { name: 'Text of source S1' });
    expect(group.querySelector('mark')).toHaveTextContent('Employees accrue 1.5 vacation days');
    expect(group).toHaveTextContent(excerpt.replaceAll('\n', ' '));
  });

  it('marks nothing for a quote that was not verified', async () => {
    const user = userEvent.setup();
    stubApi(
      chatRoutes(
        document,
        stored(
          makeAnswer({
            confidence: 'low',
            citations: [{ ...verified('Employees accrue 1.5 vacation days'), verified: false }],
            sources: [{ id: 'S1', page: 1, text: excerpt }],
          }),
        ),
      ),
    );
    render();
    const answer = await screen.findByRole('article');

    await user.click(within(answer).getByText('Source excerpt S1'));

    expect(
      within(answer).getByRole('group', { name: 'Text of source S1' }).querySelector('mark'),
    ).toBeNull();
  });
});

describe('ChatView: an answer that ended early', () => {
  const userMessage = makeUserMessage({ content: QUESTION });
  const cut = (content: string) =>
    makeAssistantMessage({ answer: null, status: 'cancelled', content });

  it('marks what was written as unfinished, so it does not read as a whole answer', async () => {
    stubApi(chatRoutes(document, [userMessage, cut('Full-time employees a  ')]));

    render();

    const partial = await screen.findByText(/Full-time employees a/);
    expect(partial).toHaveClass('italic');
    expect(partial.textContent).toBe('Full-time employees a …');
  });

  it('does not claim the person stopped a reply that the server only knows was cut short', async () => {
    stubApi(chatRoutes(document, [userMessage, cut('Employees accrue')]));

    render();

    expect(await screen.findByText('This answer was cut short')).toBeInTheDocument();
    expect(screen.queryByText('You stopped this answer')).not.toBeInTheDocument();
  });

  it('keeps saying "You stopped" for a reply this person stopped, after the saved copy replaces it', async () => {
    const user = userEvent.setup();
    let thread: MessageDto[] = [];
    stubApi({
      ...chatRoutes(document),
      [THREAD]: () => json({ messages: thread }),
      [ASK]: (call) => {
        const stream = controlledSse(call.signal);
        stream.push({ type: 'accepted', userMessage });
        stream.push({ type: 'delta', text: 'Employees accrue' });
        call.signal?.addEventListener(
          'abort',
          () => (thread = [userMessage, cut('Employees accrue')]),
        );
        return stream.response;
      },
    });
    render();
    await ask(user, QUESTION);
    await screen.findByText(/Employees accrue/);

    await pressStop(user);

    expect(await screen.findByText('You stopped this answer')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/Employees accrue/)).toHaveLength(1));
    expect(screen.getByText('You stopped this answer')).toBeInTheDocument();
    expect(screen.queryByText('This answer was cut short')).not.toBeInTheDocument();
  });

  it('is neutral when the connection dropped and the server stored the reply as cut short', async () => {
    const user = userEvent.setup();
    let thread: MessageDto[] = [];
    stubApi({
      ...chatRoutes(document),
      [THREAD]: () => json({ messages: thread }),
      [ASK]: () => {
        thread = [userMessage, cut('Employees accrue')];
        return sseResponse([
          { type: 'accepted', userMessage },
          { type: 'delta', text: 'Employees accrue' },
        ]);
      },
    });
    render();

    await ask(user, QUESTION);

    expect(await screen.findByText('This answer was cut short')).toBeInTheDocument();
    expect(screen.queryByText('You stopped this answer')).not.toBeInTheDocument();
  });

  it('does not repeat in a warning what the badge of an unreadable reply already says', async () => {
    stubApi(
      chatRoutes(
        document,
        stored(
          makeAnswer({
            status: 'unreadable',
            confidence: 'none',
            citations: [],
            followUpQuestions: [],
            warnings: ['MALFORMED_OUTPUT', 'TRUNCATED'],
          }),
        ),
      ),
    );

    render();

    expect(await screen.findByText('Reply could not be read')).toBeInTheDocument();
    expect(screen.queryByText('The reply was not in the expected format.')).not.toBeInTheDocument();
    expect(screen.getByText(/cut short because it reached a length limit/)).toBeInTheDocument();
  });
});

describe('ChatView: when the document has no answer', () => {
  const noAnswer = () =>
    stored(
      makeAnswer({
        status: 'not_found',
        confidence: 'none',
        answer: "I couldn't find that in this document.",
        citations: [],
        followUpQuestions: [],
        sources: [],
      }),
    );

  it('offers to rephrase, and the starter questions again', async () => {
    stubApi(chatRoutes(document, noAnswer()));

    render();

    const answer = await screen.findByRole('article');
    expect(within(answer).getByText('No answer found')).toBeInTheDocument();
    expect(within(answer).getByRole('button', { name: 'Try rephrasing' })).toBeInTheDocument();
    expect(within(answer).queryByRole('button', { name: 'Edit question' })).not.toBeInTheDocument();
    for (const starter of STARTER_QUESTIONS) {
      expect(within(answer).getByRole('button', { name: starter })).toBeInTheDocument();
    }
  });

  it('puts the question back in the composer to be rephrased', async () => {
    const user = userEvent.setup();
    stubApi(chatRoutes(document, noAnswer()));
    render();

    await user.click(await screen.findByRole('button', { name: 'Try rephrasing' }));

    expect(await composer()).toHaveValue(QUESTION);
    expect(await composer()).toHaveFocus();
  });

  it('asks a starter question when it is chosen', async () => {
    const user = userEvent.setup();
    const api = stubApi({
      ...chatRoutes(document, noAnswer()),
      [ASK]: (call) => controlledSse(call.signal).response,
    });
    render();
    const answer = await screen.findByRole('article');

    await user.click(within(answer).getByRole('button', { name: STARTER_QUESTIONS[0] }));

    await waitFor(() => expect(api.callsTo(ASK)).toHaveLength(1));
    expect(api.callsTo(ASK)[0]?.body).toEqual({ question: STARTER_QUESTIONS[0] });
  });
});

describe('ChatView: answers with repeated parts', () => {
  it('renders repeated ids, quotes, follow-ups and warnings without a duplicate-key warning', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const quote = 'Employees accrue 1.5 vacation days per month.';
    stubApi(
      chatRoutes(
        document,
        stored(
          makeAnswer({
            answer: 'Days accrue monthly [S1, S1] and yearly [S1].',
            citations: [verified(quote), verified(quote)],
            followUpQuestions: ['When do days expire?', 'When do days expire?'],
            warnings: ['UNCITED_MARKER', 'UNCITED_MARKER'],
          }),
        ),
      ),
    );

    render();

    await screen.findByRole('article');
    expect(screen.getAllByRole('button', { name: 'When do days expire?' })).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();
  });
});
