import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { MessageDto } from '@/shared/contracts/messages';
import { json, problem, stubApi } from '@/test/helpers/api';
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

const document = makeDocument({ title: 'Employee handbook' });
const DOC = `/api/v1/documents/${document.id}`;
const ASK = `POST ${DOC}/messages`;
const THREAD = `GET ${DOC}/messages`;
const QUESTION = 'How many vacation days do I get?';

const answerWith = (text: string, quote: string) =>
  makeAssistantMessage({
    answer: makeAnswer({
      answer: `${text} [S1].`,
      citations: [{ sourceId: 'S1', page: 1, quote, verified: true }],
      sources: [{ id: 'S1', page: 1, text: quote }],
    }),
  });

const twoAnswers = (): MessageDto[] => [
  makeUserMessage({ content: 'First question?' }),
  answerWith('First answer', 'The first source says so plainly.'),
  makeUserMessage({ content: 'Second question?' }),
  answerWith('Second answer', 'The second source says otherwise.'),
];

const render = () => renderWithClient(<ChatView documentId={document.id} />);

describe('ChatView: what a screen reader is told', () => {
  it('mounts the conversation log only once the history is here, and keeps it silent', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    stubApi({
      ...chatRoutes(document),
      [THREAD]: async () => {
        await gate;
        return json({ messages: twoAnswers() });
      },
    });

    render();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    release();

    const log = await screen.findByRole('log', { name: 'Conversation' });
    expect(log).toHaveAttribute('aria-live', 'off');
    expect(within(log).getAllByRole('article')).toHaveLength(2);
  });

  it('does not announce a thread that was already there when the page opened', async () => {
    stubApi(chatRoutes(document, twoAnswers()));

    render();

    await screen.findAllByRole('article');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('keeps one status for the whole exchange: each stage once, then that the answer is ready', async () => {
    const user = userEvent.setup();
    let stream!: ReturnType<typeof controlledSse>;
    stubApi({
      ...chatRoutes(document),
      [ASK]: (call) => {
        stream = controlledSse(call.signal);
        return stream.response;
      },
    });

    render();
    await ask(user, QUESTION);
    const status = await screen.findByRole('status');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    await waitFor(() => expect(status).toHaveTextContent('Sending your question…'));

    stream.push({ type: 'accepted', userMessage: makeUserMessage({ content: QUESTION }) });
    stream.push({ type: 'status', phase: 'retrieving' });
    await waitFor(() => expect(status).toHaveTextContent('Searching your document…'));
    stream.push({ type: 'delta', text: 'Employees accrue ' });
    await waitFor(() => expect(status).toHaveTextContent('Writing the answer…'));
    expect(window.document.querySelector('[aria-busy="true"]')).toBeNull();

    stream.push({ type: 'final', message: makeAssistantMessage() });
    stream.end();

    await waitFor(() => expect(status).toHaveTextContent('Answer ready: Quotes verified'));
    expect(screen.getByRole('status')).toBe(status);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('says a partial answer is a partial answer, in the words the card uses', async () => {
    const user = userEvent.setup();
    const partial = makeAssistantMessage({
      answer: makeAnswer({ status: 'partially_answered', confidence: 'medium' }),
    });
    stubApi({
      ...chatRoutes(document),
      [ASK]: () =>
        sseResponse([
          { type: 'accepted', userMessage: makeUserMessage({ content: QUESTION }) },
          { type: 'final', message: partial },
        ]),
    });

    render();
    await ask(user, QUESTION);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Answer ready: Partial answer'),
    );
  });

  it('names each answer after the question it answers', async () => {
    stubApi(chatRoutes(document, twoAnswers()));

    render();

    const articles = await screen.findAllByRole('article');
    expect(articles[0]).toHaveAccessibleName('Answer to: First question?');
    expect(articles[1]).toHaveAccessibleName('Answer to: Second question?');
  });

  it('has no repeated landmark or region names inside the answers', async () => {
    stubApi(chatRoutes(document, twoAnswers()));

    render();
    await screen.findAllByRole('article');

    expect(screen.queryAllByRole('region')).toHaveLength(0);
    expect(screen.getAllByText('Source excerpt S1')).toHaveLength(2);
    expect(screen.getAllByRole('group', { name: 'Text of source S1' })).toHaveLength(2);
  });
});

describe('ChatView: sources in a thread with several answers', () => {
  it('gives every element id on the page to one element only', async () => {
    stubApi(chatRoutes(document, twoAnswers()));

    render();
    await screen.findAllByRole('article');

    const ids = [...window.document.querySelectorAll('[id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points each chip at the excerpt inside its own answer', async () => {
    stubApi(chatRoutes(document, twoAnswers()));

    render();
    const articles = await screen.findAllByRole('article');

    for (const article of articles) {
      const chip = within(article).getByRole('button', { name: 'Show source S1' });
      const target = window.document.getElementById(chip.getAttribute('aria-controls')!);
      expect(target).not.toBeNull();
      expect(article).toContainElement(target);
    }
  });

  it('opens the source of the answer whose chip was pressed, and no other', async () => {
    const user = userEvent.setup();
    stubApi(chatRoutes(document, twoAnswers()));
    render();
    const [first, second] = await screen.findAllByRole('article');
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    await user.click(within(second!).getByRole('button', { name: 'Show source S1' }));

    const detailsOf = (article: HTMLElement) =>
      within(article).getByText('Source excerpt S1').closest('details')!;
    expect(detailsOf(second!)).toHaveAttribute('open');
    expect(detailsOf(first!)).not.toHaveAttribute('open');
    const scrolled = vi.mocked(Element.prototype.scrollIntoView).mock.contexts;
    expect(scrolled).toHaveLength(1);
    expect(second).toContainElement(scrolled[0] as HTMLElement);
  });

  it('moves focus to the opened excerpt, so it does not stay on a chip that may be off screen', async () => {
    const user = userEvent.setup();
    stubApi(chatRoutes(document, twoAnswers()));
    render();
    const [, second] = await screen.findAllByRole('article');

    await user.click(within(second!).getByRole('button', { name: 'Show source S1' }));

    expect(within(second!).getByText('Source excerpt S1')).toHaveFocus();
  });

  it('is a real toggle: the chip says whether its source is open, and closes it again', async () => {
    const user = userEvent.setup();
    stubApi(chatRoutes(document, twoAnswers()));
    render();
    const [, second] = await screen.findAllByRole('article');
    const chip = within(second!).getByRole('button', { name: 'Show source S1' });
    expect(chip).toHaveAttribute('aria-expanded', 'false');

    await user.click(chip);
    expect(chip).toHaveAttribute('aria-expanded', 'true');

    await user.click(chip);
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(within(second!).getByText('Source excerpt S1').closest('details')).not.toHaveAttribute(
      'open',
    );
  });

  it('keeps the chip in step when the excerpt is opened with its own summary', async () => {
    const user = userEvent.setup();
    stubApi(chatRoutes(document, twoAnswers()));
    render();
    const [first] = await screen.findAllByRole('article');

    await user.click(within(first!).getByText('Source excerpt S1'));

    await waitFor(() =>
      expect(within(first!).getByRole('button', { name: 'Show source S1' })).toHaveAttribute(
        'aria-expanded',
        'true',
      ),
    );
  });
});

describe('ChatView: where focus goes after an action', () => {
  const stillStreaming = () => {
    const holder: { stream?: ReturnType<typeof controlledSse> } = {};
    return {
      holder,
      route: (call: { signal?: AbortSignal | null | undefined }) => {
        holder.stream = controlledSse(call.signal);
        return holder.stream.response;
      },
    };
  };

  it('returns to the composer after a starter question is chosen', async () => {
    const user = userEvent.setup();
    const { route } = stillStreaming();
    stubApi({ ...chatRoutes(document), [ASK]: route });
    render();

    await user.click(
      await screen.findByRole('button', { name: 'What are the main points to remember?' }),
    );

    expect(await composer()).toHaveFocus();
  });

  it('returns to the composer after a follow-up question is chosen', async () => {
    const user = userEvent.setup();
    const { route } = stillStreaming();
    stubApi({ ...chatRoutes(document, [makeUserMessage(), makeAssistantMessage()]), [ASK]: route });
    render();

    await user.click(await screen.findByRole('button', { name: 'When do unused days expire?' }));

    expect(await composer()).toHaveFocus();
  });

  it('returns to the composer after Ask again', async () => {
    const user = userEvent.setup();
    const { route } = stillStreaming();
    stubApi({ ...chatRoutes(document, [makeUserMessage(), makeAssistantMessage()]), [ASK]: route });
    render();

    await user.click(await screen.findByRole('button', { name: 'Ask again' }));

    expect(await composer()).toHaveFocus();
  });

  it('returns to the composer after Try again on a reply that failed', async () => {
    const user = userEvent.setup();
    const failed = makeAssistantMessage({
      answer: null,
      status: 'failed',
      errorCode: 'AI_UNAVAILABLE',
      content: '',
    });
    const { route } = stillStreaming();
    stubApi({ ...chatRoutes(document, [makeUserMessage(), failed]), [ASK]: route });
    render();

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await composer()).toHaveFocus();
  });

  it('returns to the composer after Try again on a refusal', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    stubApi({
      ...chatRoutes(document),
      [ASK]: (call) =>
        ++attempts === 1
          ? problem(429, 'RATE_LIMITED', { retryAfterSeconds: 5 })
          : controlledSse(call.signal).response,
    });
    render();
    await ask(user, QUESTION);
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await composer()).toHaveFocus();
  });

  it('returns to the composer after Dismiss', async () => {
    const user = userEvent.setup();
    stubApi({ ...chatRoutes(document), [ASK]: () => problem(429, 'QUOTA_EXCEEDED') });
    render();
    await ask(user, QUESTION);

    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));

    expect(await composer()).toHaveFocus();
  });

  it('returns to the composer after Stop', async () => {
    const user = userEvent.setup();
    const { route, holder } = stillStreaming();
    stubApi({ ...chatRoutes(document), [ASK]: route });
    render();
    await ask(user, QUESTION);
    holder.stream!.push({ type: 'accepted', userMessage: makeUserMessage({ content: QUESTION }) });
    holder.stream!.push({ type: 'delta', text: 'Employees' });
    await screen.findByText(/Employees/);

    await pressStop(user);

    expect(await composer()).toHaveFocus();
  });

  it('leaves the keyboard alone on a touch screen, where focus would raise it over the answer', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }));
    const user = userEvent.setup();
    const { route } = stillStreaming();
    stubApi({ ...chatRoutes(document), [ASK]: route });
    render();

    await user.click(
      await screen.findByRole('button', { name: 'What are the main points to remember?' }),
    );

    expect(await composer()).not.toHaveFocus();
  });
});

describe('ChatView: Stop', () => {
  it('ignores a press that comes straight after it appears, like the second click of a double-click', async () => {
    const user = userEvent.setup();
    let stream!: ReturnType<typeof controlledSse>;
    const api = stubApi({
      ...chatRoutes(document),
      [ASK]: (call) => {
        stream = controlledSse(call.signal);
        return stream.response;
      },
    });
    render();
    await ask(user, QUESTION);

    await user.click(await screen.findByRole('button', { name: 'Stop' }));

    expect(api.callsTo(ASK)[0]?.signal?.aborted).toBe(false);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    stream.end();
  });

  it('gives the question back to the composer when it is stopped before the server took it', async () => {
    const user = userEvent.setup();
    stubApi({
      ...chatRoutes(document),
      [ASK]: (call) => controlledSse(call.signal).response,
      [THREAD]: () => json({ messages: [] }),
    });
    render();
    await ask(user, QUESTION);
    expect(await composer()).toHaveValue('');

    await pressStop(user);

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveValue(QUESTION),
    );
  });

  it('does not overwrite what has been typed since', async () => {
    const user = userEvent.setup();
    stubApi({
      ...chatRoutes(document),
      [ASK]: (call) => controlledSse(call.signal).response,
    });
    render();
    await ask(user, QUESTION);
    await user.type(await composer(), 'Something else');

    await pressStop(user);

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument(),
    );
    expect(await composer()).toHaveValue('Something else');
  });
});

describe('ChatView: when the session has ended', () => {
  it('offers a way back to sign in instead of a retry that cannot work', async () => {
    const user = userEvent.setup();
    stubApi({ ...chatRoutes(document), [ASK]: () => problem(401, 'UNAUTHENTICATED') });
    render();

    await ask(user, QUESTION);

    expect(await screen.findByRole('alert')).toHaveTextContent('session has expired');
    expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});

describe('ChatView: layout', () => {
  it('fills the screen so the composer sits at the bottom, as wide as the cards above it', async () => {
    stubApi(chatRoutes(document));
    render();

    const form = await screen.findByRole('form', { name: 'Ask a question' });
    const composerBar = form.parentElement!;
    expect(composerBar).toHaveClass('sticky', 'bottom-0');
    expect(composerBar.className).not.toMatch(/-mx-|\bpx-/);
    const root = composerBar.parentElement!;
    expect(root).toHaveClass('flex', 'flex-col', 'min-h-[calc(100dvh-7.5rem)]');
  });

  it('lets the composer stop covering the thread on a short screen', async () => {
    stubApi(chatRoutes(document));
    render();

    const form = await screen.findByRole('form', { name: 'Ask a question' });

    expect(form.parentElement!.className).toContain('[@media(max-height:32rem)]:static');
  });
});
