import { useMutation, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, type ClientErrorCode } from '@/lib/api-client';
import { onSignedOutElsewhere } from '@/lib/auth-channel';

import { Providers } from './providers';

const replace = vi.fn();
// One object for every render, as the App Router gives.
const router = { replace };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const pause = () => new Promise((resolve) => setTimeout(resolve, 25));
const failure = (status: number, code: ClientErrorCode) => new ApiError(status, code, 'It failed');

function signOutInAnotherTab() {
  const channel = new BroadcastChannel('docqa-auth');
  channel.postMessage('signed-out');
  channel.close();
}

function FailingQuery({ id, error }: { readonly id: string; readonly error: ApiError }) {
  const { isError } = useQuery({
    queryKey: [id],
    queryFn: () => Promise.reject(error),
    retry: false,
  });
  return <p>{isError ? `${id} failed` : `${id} loading`}</p>;
}

function FailingAction({ error }: { readonly error: ApiError }) {
  const { mutate, isError } = useMutation({ mutationFn: () => Promise.reject(error) });
  return (
    <button type="button" onClick={() => mutate()}>
      {isError ? 'Failed' : 'Go'}
    </button>
  );
}

beforeEach(() => replace.mockClear());

describe('Providers: when another tab signs out', () => {
  it('sends the person to the sign-in page, so private pages do not stay on screen', async () => {
    render(
      <Providers>
        <p>Private documents</p>
      </Providers>,
    );

    signOutInAnotherTab();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('stops listening once the page is gone', async () => {
    const heard = vi.fn();
    const { unmount } = render(
      <Providers>
        <p>Private documents</p>
      </Providers>,
    );
    unmount();
    const stop = onSignedOutElsewhere(heard);

    signOutInAnotherTab();
    await waitFor(() => expect(heard).toHaveBeenCalledTimes(1));

    expect(replace).not.toHaveBeenCalled();
    stop();
  });
});

describe('Providers: when a request finds the session has ended', () => {
  it('sends the person to the sign-in page, once however many requests fail', async () => {
    render(
      <Providers>
        <FailingQuery id="documents" error={failure(401, 'UNAUTHENTICATED')} />
        <FailingQuery id="thread" error={failure(401, 'UNAUTHENTICATED')} />
      </Providers>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    await screen.findByText('thread failed');
    await pause();

    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('does the same when an action, like a delete, is the one that finds out', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <FailingAction error={failure(401, 'UNAUTHENTICATED')} />
      </Providers>,
    );

    await user.click(screen.getByRole('button', { name: 'Go' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it.each([
    [500, 'INTERNAL'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [401, 'INVALID_CREDENTIALS'],
  ] as const)('stays where it is for a %i failure (%s)', async (status, code) => {
    render(
      <Providers>
        <FailingQuery id="documents" error={failure(status, code)} />
      </Providers>,
    );

    await screen.findByText('documents failed');

    expect(replace).not.toHaveBeenCalled();
  });
});
