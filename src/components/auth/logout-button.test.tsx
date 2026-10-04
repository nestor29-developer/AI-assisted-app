import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { problem, stubApi } from '@/test/helpers/api';

import { LogoutButton } from './logout-button';

const replace = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));

const SIGN_OUT = 'POST /api/v1/auth/logout';
const cleared = () => new Response(null, { status: 204 });
const pause = () => new Promise((resolve) => setTimeout(resolve, 25));

/** Another tab of the same browser, listening the way the app's own pages do. */
function otherTab() {
  const channel = new BroadcastChannel('docqa-auth');
  const heard = vi.fn();
  channel.onmessage = heard;
  return { heard, close: () => channel.close() };
}

beforeEach(() => {
  replace.mockClear();
  refresh.mockClear();
});

describe('LogoutButton: when the server clears the session', () => {
  it('goes to the sign-in page', async () => {
    const user = userEvent.setup();
    stubApi({ [SIGN_OUT]: cleared });
    render(<LogoutButton />);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('tells the other tabs, so they do not keep showing the documents', async () => {
    const user = userEvent.setup();
    stubApi({ [SIGN_OUT]: cleared });
    const tab = otherTab();
    render(<LogoutButton />);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(tab.heard).toHaveBeenCalledTimes(1));
    expect(tab.heard.mock.calls[0]?.[0]).toMatchObject({ data: 'signed-out' });
    tab.close();
  });
});

describe('LogoutButton: when signing out fails', () => {
  it('stays on the page and says the person is still signed in', async () => {
    const user = userEvent.setup();
    stubApi({
      [SIGN_OUT]: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const tab = otherTab();
    render(<LogoutButton />);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You are still signed in. Could not reach the server. Check your connection and try again.',
    );
    await pause();
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(tab.heard).not.toHaveBeenCalled();
    tab.close();
  });

  it('gives the button back, and a second try that works signs out and clears the message', async () => {
    const user = userEvent.setup();
    let broken = true;
    stubApi({ [SIGN_OUT]: () => (broken ? problem(500, 'INTERNAL') : cleared()) });
    render(<LogoutButton />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You are still signed in. Something went wrong on our side. Please try again.',
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).not.toHaveAttribute('aria-busy');

    broken = false;
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('can be dismissed, which hands focus back to the button and signs nobody out', async () => {
    const user = userEvent.setup();
    stubApi({ [SIGN_OUT]: () => problem(500, 'INTERNAL') });
    render(<LogoutButton />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toHaveFocus();
    expect(replace).not.toHaveBeenCalled();
  });
});
