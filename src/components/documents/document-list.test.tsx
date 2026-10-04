import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { json, problem, stubApi } from '@/test/helpers/api';
import { renderWithClient } from '@/test/helpers/render';
import { makeDocument } from '@/test/fixtures/messages';

import { DocumentList } from './document-list';

const handbook = makeDocument({ title: 'Employee handbook', chunkCount: 4, sizeBytes: 48_000 });
const policy = makeDocument({
  title: 'Leave policy',
  mimeType: 'application/pdf',
  pageCount: 12,
  chunkCount: 1,
});

describe('DocumentList', () => {
  it('shows a loading placeholder first, then the documents with what matters about each', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    stubApi({
      'GET /api/v1/documents': async () => {
        await gate;
        return json({ documents: [handbook, policy] });
      },
    });

    renderWithClient(<DocumentList />);

    expect(screen.getByRole('status', { name: 'Loading your documents' })).toBeInTheDocument();
    release();

    const link = await screen.findByRole('link', { name: 'Employee handbook' });
    expect(link).toHaveAttribute('href', `/documents/${handbook.id}`);
    expect(screen.getByText(/Markdown file · 48 KB · 4 sections/)).toBeInTheDocument();
    expect(screen.getByText(/PDF, 12 pages · .* · 1 section · /)).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: 'Loading your documents' }),
    ).not.toBeInTheDocument();
  });

  it('explains that there is nothing yet, instead of showing an empty box', async () => {
    stubApi({ 'GET /api/v1/documents': () => json({ documents: [] }) });

    renderWithClient(<DocumentList />);

    expect(await screen.findByText('No documents yet')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows what went wrong and lets the person try again', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    stubApi({
      'GET /api/v1/documents': () =>
        ++attempts === 1 ? problem(503, 'AI_UNAVAILABLE') : json({ documents: [handbook] }),
    });

    renderWithClient(<DocumentList />);

    expect(await screen.findByRole('alert')).toHaveTextContent('not responding');
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('link', { name: 'Employee handbook' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('asks before deleting, deletes, and refreshes the list', async () => {
    const user = userEvent.setup();
    let documents = [handbook, policy];
    const api = stubApi({
      'GET /api/v1/documents': () => json({ documents }),
      [`DELETE /api/v1/documents/${handbook.id}`]: () => {
        documents = [policy];
        return new Response(null, { status: 204 });
      },
    });

    renderWithClient(<DocumentList />);
    await user.click(await screen.findByRole('button', { name: 'Delete Employee handbook' }));

    const confirmation = screen.getByRole('group', { name: 'Confirm delete' });
    expect(api.callsTo(`DELETE /api/v1/documents/${handbook.id}`)).toHaveLength(0);
    await user.click(within(confirmation).getByRole('button', { name: 'Yes, delete' }));

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Employee handbook' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'Leave policy' })).toBeInTheDocument();
  });

  it('lets the person back out of a delete', async () => {
    const user = userEvent.setup();
    const api = stubApi({ 'GET /api/v1/documents': () => json({ documents: [handbook] }) });

    renderWithClient(<DocumentList />);
    await user.click(await screen.findByRole('button', { name: 'Delete Employee handbook' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('group', { name: 'Confirm delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Employee handbook' })).toBeInTheDocument();
    expect(api.calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('keeps the document and says so when the delete fails', async () => {
    const user = userEvent.setup();
    stubApi({
      'GET /api/v1/documents': () => json({ documents: [handbook] }),
      [`DELETE /api/v1/documents/${handbook.id}`]: () => problem(500, 'INTERNAL'),
    });

    renderWithClient(<DocumentList />);
    await user.click(await screen.findByRole('button', { name: 'Delete Employee handbook' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side');
    expect(screen.getByRole('link', { name: 'Employee handbook' })).toBeInTheDocument();
  });

  it('lets a long title wrap onto a second line instead of cutting it off', async () => {
    stubApi({
      'GET /api/v1/documents': () =>
        json({ documents: [makeDocument({ title: `Handbook ${'x'.repeat(120)}` })] }),
    });

    renderWithClient(<DocumentList />);

    const link = await screen.findByRole('link', { name: /^Handbook x+/ });
    expect(link).toHaveClass('line-clamp-2', 'wrap-break-word');
    expect(link).not.toHaveClass('truncate');
  });
});

describe('DocumentList: where focus goes', () => {
  const openConfirmation = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(await screen.findByRole('button', { name: 'Delete Employee handbook' }));

  it('puts focus on Cancel, the safe choice, when the question opens', async () => {
    const user = userEvent.setup();
    stubApi({ 'GET /api/v1/documents': () => json({ documents: [handbook] }) });

    renderWithClient(<DocumentList />);
    await openConfirmation(user);

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('gives focus back to the Delete button when the person cancels', async () => {
    const user = userEvent.setup();
    stubApi({ 'GET /api/v1/documents': () => json({ documents: [handbook] }) });

    renderWithClient(<DocumentList />);
    await openConfirmation(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Delete Employee handbook' })).toHaveFocus();
  });

  it('gives focus back to the Delete button when the delete fails', async () => {
    const user = userEvent.setup();
    stubApi({
      'GET /api/v1/documents': () => json({ documents: [handbook] }),
      [`DELETE /api/v1/documents/${handbook.id}`]: () => problem(500, 'INTERNAL'),
    });

    renderWithClient(<DocumentList />);
    await openConfirmation(user);
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Delete Employee handbook' })).toHaveFocus();
  });

  it('moves focus to the list heading after a delete, and says what was deleted', async () => {
    const user = userEvent.setup();
    let documents = [handbook, policy];
    stubApi({
      'GET /api/v1/documents': () => json({ documents }),
      [`DELETE /api/v1/documents/${handbook.id}`]: () => {
        documents = [policy];
        return new Response(null, { status: 204 });
      },
    });

    renderWithClient(<DocumentList />);
    await openConfirmation(user);
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Your documents' })).toHaveFocus(),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Employee handbook was deleted.');
  });

  it('says it again when a second document with the same title is deleted', async () => {
    const user = userEvent.setup();
    const twin = makeDocument({ title: 'Employee handbook' });
    let documents = [handbook, twin];
    stubApi({
      'GET /api/v1/documents': () => json({ documents }),
      [`DELETE /api/v1/documents/${handbook.id}`]: () => {
        documents = [twin];
        return new Response(null, { status: 204 });
      },
      [`DELETE /api/v1/documents/${twin.id}`]: () => {
        documents = [];
        return new Response(null, { status: 204 });
      },
    });

    renderWithClient(<DocumentList />);
    const [firstDelete] = await screen.findAllByRole('button', {
      name: 'Delete Employee handbook',
    });
    await user.click(firstDelete!);
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Employee handbook was deleted.'),
    );
    const first = screen.getByRole('status').textContent;
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Delete Employee handbook' })).toHaveLength(1),
    );

    await openConfirmation(user);
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe(first));
    expect(screen.getByRole('status')).toHaveTextContent('Employee handbook was deleted.');
  });

  it('leaves focus alone if the person moved on while the delete was running', async () => {
    const user = userEvent.setup();
    let documents = [handbook, policy];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    stubApi({
      'GET /api/v1/documents': () => json({ documents }),
      [`DELETE /api/v1/documents/${handbook.id}`]: async () => {
        await gate;
        documents = [policy];
        return new Response(null, { status: 204 });
      },
    });

    renderWithClient(<DocumentList />);
    await openConfirmation(user);
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    const elsewhere = screen.getByRole('link', { name: 'Leave policy' });
    act(() => elsewhere.focus());
    release();

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Employee handbook' })).not.toBeInTheDocument(),
    );
    expect(elsewhere).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Employee handbook was deleted.');
  });

  it('keeps Yes, delete focused while it works, and sends one request however often it is pressed', async () => {
    const user = userEvent.setup();
    const api = stubApi({
      'GET /api/v1/documents': () => json({ documents: [handbook] }),
      [`DELETE /api/v1/documents/${handbook.id}`]: () => new Promise<Response>(() => undefined),
    });

    renderWithClient(<DocumentList />);
    await openConfirmation(user);
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    const waiting = await screen.findByRole('button', { name: 'Please wait…' });
    await user.click(waiting);
    await user.click(waiting);

    expect(waiting).toHaveFocus();
    expect(waiting).toHaveAttribute('aria-disabled', 'true');
    expect(api.callsTo(`DELETE /api/v1/documents/${handbook.id}`)).toHaveLength(1);
  });
});
