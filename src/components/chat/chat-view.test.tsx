import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { MessageDto } from '@/shared/contracts/messages';
import { json, problem, stubApi } from '@/test/helpers/api';
import {
  ask as askQuestion,
  chatRoutes,
  composer,
  pressStop,
  type User,
} from '@/test/helpers/chat';
import { renderWithClient } from '@/test/helpers/render';
import { controlledSse, sseResponse } from '@/test/helpers/sse';
import {
  makeAnswer,
  makeAssistantMessage,
  makeDocument,
  makeUserMessage,
} from '@/test/fixtures/messages';

import { ChatView } from './chat-view';

const document = makeDocument({ title: 'Employee handbook' });
const DOC = `/api/v1/documents/${document.id}`;
const ASK = `POST ${DOC}/messages`;
const THREAD = `GET ${DOC}/messages`;
const QUESTION = 'How many vacation days do I get?';

const baseRoutes = (messages: MessageDto[] = []) => chatRoutes(document, messages);

const ask = (user: User, question = QUESTION) => askQuestion(user, question);

describe('ChatView: asking a question', () => {
  it('shows each stage of the answer as it happens, then a checked answer', async () => {
    const user = userEvent.setup();
    const userMessage = makeUserMessage({ content: QUESTION });
    const reply = makeAssistantMessage();
    let stream!: ReturnType<typeof controlledSse>;
    const api = stubApi({
      ...baseRoutes(),
      [ASK]: (call) => {
        stream = controlledSse(call.signal);
        return stream.response;
      },
    });

    renderWithClient(<ChatView documentId={document.id} />);
    await ask(user);

    // The question appears at once, before the server has said anything.
    expect(await screen.findByText(QUESTION)).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('Sending your question…');
    expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveValue('');

    stream.push({ type: 'accepted', userMessage });
    stream.push({ type: 'status', phase: 'retrieving' });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Searching your document…'),
    );
    stream.push({ type: 'status', phase: 'generating' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Thinking…'));
    stream.push({ type: 'delta', text: 'Employees accrue ' });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Writing the answer…'),
    );
    expect(screen.getByText(/Employees accrue/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask' })).not.toBeInTheDocument();

    stream.push({ type: 'final', message: reply });
    stream.end();

    const answer = await screen.findByRole('article', { name: /^Answer/ });
    expect(within(answer).getByText('Quotes verified')).toBeInTheDocument();
    expect(within(answer).getByText('Quote found in the document')).toBeInTheDocument();
    expect(screen.getAllByText(QUESTION)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();

    const post = api.callsTo(ASK)[0]!;
    expect(post.body).toEqual({ question: QUESTION });
    expect(post.headers.get('accept')).toBe('text/event-stream');
  });

  it('offers starter questions on an empty thread and asks the one that is clicked', async () => {
    const user = userEvent.setup();
    const api = stubApi({
      ...baseRoutes(),
      [ASK]: () =>
        sseResponse([
          { type: 'accepted', userMessage: makeUserMessage({ content: 'Starter' }) },
          { type: 'final', message: makeAssistantMessage() },
        ]),
    });

    renderWithClient(<ChatView documentId={document.id} />);
    expect(await screen.findByText('Ask your first question')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'What are the key dates or deadlines?' }));

    expect(await screen.findByRole('article', { name: /^Answer/ })).toBeInTheDocument();
    expect(api.callsTo(ASK)[0]?.body).toEqual({ question: 'What are the key dates or deadlines?' });
    expect(screen.queryByText('Ask your first question')).not.toBeInTheDocument();
  });

  it('sends on Enter but keeps Shift+Enter for a new line, and never sends blank questions', async () => {
    const user = userEvent.setup();
    const api = stubApi({
      ...baseRoutes(),
      [ASK]: () => sseResponse([{ type: 'final', message: makeAssistantMessage() }]),
    });

    renderWithClient(<ChatView documentId={document.id} />);
    const box = await composer();
    await user.type(box, '   {Enter}');
    expect(api.callsTo(ASK)).toHaveLength(0);

    await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(box).toHaveValue('   line one\nline two');
    expect(api.callsTo(ASK)).toHaveLength(0);

    await user.keyboard('{Enter}');
    await waitFor(() => expect(api.callsTo(ASK)).toHaveLength(1));
    expect(api.callsTo(ASK)[0]?.body).toEqual({ question: 'line one\nline two' });
  });

  it('keeps the composer off until the conversation has loaded', async () => {
    stubApi({ ...baseRoutes(), [THREAD]: () => new Promise<Response>(() => undefined) });

    renderWithClient(<ChatView documentId={document.id} />);

    expect(
      await screen.findByRole('status', { name: 'Loading the conversation' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Your question' })).toBeDisabled();
  });
});

describe('ChatView: when something goes wrong', () => {
  it('explains a refusal with how long to wait, keeps the question, and can try again or dismiss', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const api = stubApi({
      ...baseRoutes(),
      [ASK]: () =>
        ++attempts === 1
          ? problem(429, 'RATE_LIMITED', { retryAfterSeconds: 20 })
          : sseResponse([{ type: 'final', message: makeAssistantMessage() }]),
    });

    renderWithClient(<ChatView documentId={document.id} />);
    await ask(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many requests. Try again in 20 seconds.',
    );
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Your question' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('article', { name: /^Answer/ })).toBeInTheDocument();
    expect(api.callsTo(ASK)).toHaveLength(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('lets a refusal be dismissed', async () => {
    const user = userEvent.setup();
    stubApi({ ...baseRoutes(), [ASK]: () => problem(429, 'QUOTA_EXCEEDED') });

    renderWithClient(<ChatView documentId={document.id} />);
    await ask(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('usage limit');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(QUESTION)).not.toBeInTheDocument();
  });

  it('shows the stored error when the AI fails after the question was accepted, with a way to retry', async () => {
    const user = userEvent.setup();
    const userMessage = makeUserMessage({ content: QUESTION });
    const failed = makeAssistantMessage({
      answer: null,
      status: 'failed',
      errorCode: 'AI_UNAVAILABLE',
      content: '',
    });
    let stored: MessageDto[] = [];
    const api = stubApi({
      ...baseRoutes(),
      [THREAD]: () => json({ messages: stored }),
      [ASK]: () => {
        stored = [userMessage, failed];
        return sseResponse([
          { type: 'accepted', userMessage },
          { type: 'delta', text: 'Partial ' },
          {
            type: 'error',
            problem: {
              type: 'urn:problem:ai-unavailable',
              title: 'AI unavailable',
              status: 503,
              code: 'AI_UNAVAILABLE',
            },
          },
        ]);
      },
    });

    renderWithClient(<ChatView documentId={document.id} />);
    await ask(user);

    expect(await screen.findByText('Could not get an answer')).toBeInTheDocument();
    expect(screen.getByText(/not responding right now/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Could not get an answer.'),
    );

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.callsTo(ASK)).toHaveLength(2));
    expect(api.callsTo(ASK)[1]?.body).toEqual({ question: QUESTION });
  });

  it('keeps what was stored when the user presses Stop', async () => {
    const user = userEvent.setup();
    const userMessage = makeUserMessage({ content: QUESTION });
    const stopped = makeAssistantMessage({
      answer: null,
      status: 'cancelled',
      content: 'Employees accrue',
    });
    let stored: MessageDto[] = [];
    let stream!: ReturnType<typeof controlledSse>;
    const api = stubApi({
      ...baseRoutes(),
      [THREAD]: () => json({ messages: stored }),
      [ASK]: (call) => {
        stream = controlledSse(call.signal);
        call.signal?.addEventListener('abort', () => (stored = [userMessage, stopped]));
        return stream.response;
      },
    });

    renderWithClient(<ChatView documentId={document.id} />);
    await ask(user);
    stream.push({ type: 'accepted', userMessage });
    stream.push({ type: 'delta', text: 'Employees accrue' });
    await screen.findByText(/Employees accrue/);

    await pressStop(user);

    expect(await screen.findByText('You stopped this answer')).toBeInTheDocument();
    expect(screen.getByText('Employees accrue')).toBeInTheDocument();
    expect(api.callsTo(ASK)[0]?.signal?.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'Ask again' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  describe('when the server is slow to save a stopped answer', () => {
    const userMessage = makeUserMessage({ content: QUESTION });

    function setup(storedAfterReads: number | null) {
      const savedReply = makeAssistantMessage({
        answer: null,
        status: 'cancelled',
        content: 'Employees accrue (saved)',
      });
      const streams: ReturnType<typeof controlledSse>[] = [];
      let reads = 0;
      const api = stubApi({
        ...baseRoutes(),
        [THREAD]: () => {
          reads += 1;
          const saved = storedAfterReads !== null && reads > storedAfterReads;
          return json({ messages: saved ? [userMessage, savedReply] : [] });
        },
        [ASK]: (call) => {
          const stream = controlledSse(call.signal);
          streams.push(stream);
          return stream.response;
        },
      });
      return { api, streams };
    }

    const stopAfterSomeText = async (
      user: ReturnType<typeof userEvent.setup>,
      stream: ReturnType<typeof controlledSse> | undefined,
    ) => {
      stream!.push({ type: 'accepted', userMessage });
      stream!.push({ type: 'delta', text: 'Employees accrue' });
      await screen.findByText(/Employees accrue/);
      await pressStop(user);
    };

    it('shows the stop at once, then swaps in the saved reply when it appears', async () => {
      const user = userEvent.setup();
      const { streams } = setup(2);

      renderWithClient(<ChatView documentId={document.id} />);
      await ask(user);
      await stopAfterSomeText(user, streams[0]);

      expect(await screen.findByText('You stopped this answer')).toBeInTheDocument();
      expect(screen.getByText('Employees accrue')).toBeInTheDocument();

      expect(
        await screen.findByText('Employees accrue (saved)', {}, { timeout: 4000 }),
      ).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText('Employees accrue')).not.toBeInTheDocument());
      expect(screen.getAllByText('You stopped this answer')).toHaveLength(1);
    });

    it('keeps the stop on screen when the server never shows a saved reply', async () => {
      const user = userEvent.setup();
      const { api, streams } = setup(null);

      renderWithClient(<ChatView documentId={document.id} />);
      await ask(user);
      await stopAfterSomeText(user, streams[0]);

      await waitFor(() => expect(api.callsTo(THREAD).length).toBeGreaterThanOrEqual(6), {
        timeout: 5000,
      });
      expect(screen.getByText('You stopped this answer')).toBeInTheDocument();
      expect(screen.getByText('Employees accrue')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Ask again' })).toBeEnabled();
    });

    it('does not let the late arrival of a saved reply wipe a question asked in the meantime', async () => {
      const user = userEvent.setup();
      const { streams } = setup(3);

      renderWithClient(<ChatView documentId={document.id} />);
      await ask(user);
      await stopAfterSomeText(user, streams[0]);
      await user.click(await screen.findByRole('button', { name: 'Ask again' }));
      await waitFor(() => expect(streams).toHaveLength(2));

      await new Promise((resolve) => setTimeout(resolve, 2000));

      expect(screen.getByRole('status')).toHaveTextContent('Sending your question…');
      expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    });
  });

  it('says so when the document does not exist', async () => {
    stubApi({
      [`GET ${DOC}`]: () => problem(404, 'NOT_FOUND', { detail: 'Document not found' }),
      [THREAD]: () => problem(404, 'NOT_FOUND'),
    });

    renderWithClient(<ChatView documentId={document.id} />);

    expect(await screen.findByText('Document not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your documents' })).toHaveAttribute(
      'href',
      '/documents',
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('lets the person retry when the conversation cannot be loaded', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    stubApi({
      ...baseRoutes(),
      [THREAD]: () => (++attempts === 1 ? problem(500, 'INTERNAL') : json({ messages: [] })),
    });

    renderWithClient(<ChatView documentId={document.id} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side');
    expect(screen.getByRole('textbox', { name: 'Your question' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Ask your first question')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Your question' })).toBeEnabled();
  });
});

describe('ChatView: a stored conversation', () => {
  it('shows the document, the question and an answer whose sources can be opened', async () => {
    const user = userEvent.setup();
    stubApi(
      baseRoutes([
        makeUserMessage({ content: QUESTION }),
        makeAssistantMessage({
          answer: makeAnswer({
            answer: 'Employees accrue 1.5 days per month [S1].',
            sources: [{ id: 'S1', page: 2, text: 'Full source text: employees accrue 1.5 days.' }],
          }),
        }),
      ]),
    );

    renderWithClient(<ChatView documentId={document.id} />);

    expect(await screen.findByRole('heading', { name: 'Employee handbook' })).toBeInTheDocument();
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
    const answer = await screen.findByRole('article', { name: /^Answer/ });
    for (const datum of ['gemini-3.8-flash', 'prompt v1', '1,200 in / 80 out tokens', '1.5 s']) {
      expect(within(answer).getByText(datum)).toHaveClass('whitespace-nowrap');
    }
    expect(within(answer).getByText('Page 2')).toBeInTheDocument();

    const details = within(answer).getByText('Source excerpt S1').closest('details')!;
    expect(details).not.toHaveAttribute('open');
    await user.click(within(answer).getByRole('button', { name: 'Show source S1' }));

    expect(details).toHaveAttribute('open');
    expect(within(answer).getByText(/Full source text/)).toBeVisible();
  });

  it('is honest about an answer that could not be verified', async () => {
    stubApi(
      baseRoutes([
        makeUserMessage(),
        makeAssistantMessage({
          answer: makeAnswer({
            confidence: 'low',
            warnings: ['UNVERIFIED_CITATION', 'UNCITED_MARKER'],
            citations: [
              { sourceId: 'S1', page: null, quote: 'Invented quote text', verified: false },
            ],
          }),
        }),
      ]),
    );

    renderWithClient(<ChatView documentId={document.id} />);

    const answer = await screen.findByRole('article', { name: /^Answer/ });
    expect(within(answer).getByText('Unverified, double-check')).toBeInTheDocument();
    expect(within(answer).getByText('Quote not found in the cited excerpt')).toBeInTheDocument();
    expect(
      within(answer).getByText('At least one quote could not be found in its source.'),
    ).toBeInTheDocument();
    expect(
      within(answer).getByText('Part of the answer points to a source without quoting it.'),
    ).toBeInTheDocument();
  });

  it.each([
    ['not_found', 'none', 'No answer found'],
    ['declined', 'none', 'Declined'],
    ['unreadable', 'none', 'Reply could not be read'],
    ['partially_answered', 'medium', 'Partial answer'],
  ] as const)('labels a %s answer', async (status, confidence, label) => {
    stubApi(
      baseRoutes([
        makeUserMessage(),
        makeAssistantMessage({
          answer: makeAnswer({ status, confidence, citations: [], followUpQuestions: [] }),
        }),
      ]),
    );

    renderWithClient(<ChatView documentId={document.id} />);

    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it('renders the answer as plain text, never as HTML', async () => {
    stubApi(
      baseRoutes([
        makeUserMessage({ content: '<img src=x onerror=alert(1)> question' }),
        makeAssistantMessage({
          answer: makeAnswer({ answer: '<b>bold</b> <img src=x onerror=alert(2)> [S1]' }),
        }),
      ]),
    );

    const { container } = renderWithClient(<ChatView documentId={document.id} />);

    expect(
      await screen.findByText(/<b>bold<\/b> <img src=x onerror=alert\(2\)>/),
    ).toBeInTheDocument();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)> question/)).toBeInTheDocument();
    expect(container.querySelector('img, b')).toBeNull();
  });

  it('asks again, edits the question, and asks a follow-up on request', async () => {
    const user = userEvent.setup();
    const api = stubApi({
      ...baseRoutes([makeUserMessage({ content: QUESTION }), makeAssistantMessage()]),
      [ASK]: () => sseResponse([{ type: 'final', message: makeAssistantMessage() }]),
    });

    renderWithClient(<ChatView documentId={document.id} />);
    await screen.findByRole('article', { name: /^Answer/ });

    await user.click(screen.getByRole('button', { name: 'Edit question' }));
    const box = screen.getByRole('textbox', { name: 'Your question' });
    expect(box).toHaveValue(QUESTION);
    expect(box).toHaveFocus();
    expect(api.callsTo(ASK)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Ask again' }));
    await waitFor(() => expect(api.callsTo(ASK)).toHaveLength(1));
    expect(api.callsTo(ASK)[0]?.body).toEqual({ question: QUESTION });

    await user.click(screen.getAllByRole('button', { name: 'When do unused days expire?' })[0]!);
    await waitFor(() => expect(api.callsTo(ASK)).toHaveLength(2));
    expect(api.callsTo(ASK)[1]?.body).toEqual({ question: 'When do unused days expire?' });
  });

  it('records feedback and shows the choice', async () => {
    const user = userEvent.setup();
    const reply = makeAssistantMessage();
    const api = stubApi({
      ...baseRoutes([makeUserMessage(), reply]),
      [`POST /api/v1/messages/${reply.id}/feedback`]: () =>
        json({ message: { ...reply, feedback: 'up' } }),
    });

    renderWithClient(<ChatView documentId={document.id} />);
    await user.click(await screen.findByRole('button', { name: 'Helpful' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Helpful' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect(screen.getByText('Thanks for the feedback')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not helpful' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(api.callsTo(`POST /api/v1/messages/${reply.id}/feedback`)[0]?.body).toEqual({
      value: 'up',
    });
  });

  it('says when feedback could not be saved', async () => {
    const user = userEvent.setup();
    const reply = makeAssistantMessage();
    stubApi({
      ...baseRoutes([makeUserMessage(), reply]),
      [`POST /api/v1/messages/${reply.id}/feedback`]: () => problem(500, 'INTERNAL'),
    });

    renderWithClient(<ChatView documentId={document.id} />);
    await user.click(await screen.findByRole('button', { name: 'Not helpful' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your feedback could not be saved');
  });
});
