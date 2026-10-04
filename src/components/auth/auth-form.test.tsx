import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { json, problem, stubApi } from '@/test/helpers/api';

import { AuthForm } from './auth-form';

const replace = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));

const SESSION = { user: { id: '00000000-0000-4000-8000-000000000001', email: 'a@example.test' } };

beforeEach(() => {
  replace.mockClear();
  refresh.mockClear();
});

describe('AuthForm: when a submit is turned back', () => {
  it('moves focus to the first field in error and describes it with the reason', async () => {
    const user = userEvent.setup();
    const api = stubApi({});
    render(<AuthForm mode="login" />);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const email = screen.getByLabelText('Email');
    expect(email).toHaveFocus();
    expect(email).toBeInvalid();
    expect(email).toHaveAccessibleDescription(/email/i);
    expect(api.calls).toHaveLength(0);
  });

  it('moves on to the password once the email is fine', async () => {
    const user = userEvent.setup();
    render(<AuthForm mode="register" />);
    await user.type(screen.getByLabelText('Email'), 'a@example.test');
    await user.type(screen.getByLabelText('Password'), 'short');

    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByLabelText('Password')).toHaveFocus();
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
      'Use at least 10 characters.',
    );
  });

  it('does not point the password at a hint that is hidden while the error shows', async () => {
    const user = userEvent.setup();
    render(<AuthForm mode="register" />);
    await user.type(screen.getByLabelText('Email'), 'a@example.test');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    const password = screen.getByLabelText('Password');
    for (const id of password.getAttribute('aria-describedby')!.split(' ')) {
      expect(window.document.getElementById(id)).toBeInTheDocument();
    }
  });
});

describe('AuthForm: signing in', () => {
  it('goes to the documents once the server accepts the sign-in', async () => {
    const user = userEvent.setup();
    stubApi({ 'POST /api/v1/auth/login': () => json(SESSION) });
    render(<AuthForm mode="login" />);

    await user.type(screen.getByLabelText('Email'), 'a@example.test');
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/documents'));
  });

  it('keeps the button focused and signs in once, however often it is pressed', async () => {
    const user = userEvent.setup();
    const api = stubApi({
      'POST /api/v1/auth/login': () => new Promise<Response>(() => undefined),
    });
    render(<AuthForm mode="login" />);
    await user.type(screen.getByLabelText('Email'), 'a@example.test');
    await user.type(screen.getByLabelText('Password'), 'secret');

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const waiting = await screen.findByRole('button', { name: 'Please wait…' });
    await user.click(waiting);
    await user.click(waiting);

    expect(waiting).toHaveFocus();
    expect(waiting).toHaveAttribute('aria-disabled', 'true');
    expect(api.callsTo('POST /api/v1/auth/login')).toHaveLength(1);
  });

  it('shows the server’s reason and lets the person try again', async () => {
    const user = userEvent.setup();
    stubApi({
      'POST /api/v1/auth/login': () =>
        problem(401, 'INVALID_CREDENTIALS', { detail: 'Wrong email or password.' }),
    });
    render(<AuthForm mode="login" />);

    await user.type(screen.getByLabelText('Email'), 'a@example.test');
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toHaveAttribute('aria-disabled');
    expect(replace).not.toHaveBeenCalled();
  });
});
