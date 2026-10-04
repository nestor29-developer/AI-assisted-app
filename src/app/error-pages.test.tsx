import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import AppError from './(app)/error';
import AppNotFound from './(app)/not-found';
import NotFound from './not-found';

describe('the page for an address that does not exist', () => {
  it('says so, in the app’s own style, with a way back to the documents', () => {
    render(<NotFound />);

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your documents' })).toHaveAttribute(
      'href',
      '/documents',
    );
  });

  it('brings its own main landmark when it is shown outside the signed-in shell', () => {
    render(<NotFound />);

    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('adds no second main inside the signed-in shell, which already has one', () => {
    render(<AppNotFound />);

    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your documents' })).toBeInTheDocument();
  });
});

describe('the page for a screen that broke', () => {
  it('says what happened, announces it, and lets the person try the page again', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(<AppError error={new Error('boom')} retry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Something went wrong');
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows none of the error’s own text, which can carry details meant for the logs', () => {
    render(<AppError error={new Error('SELECT * FROM secrets')} retry={() => undefined} />);

    expect(screen.queryByText(/SELECT/)).not.toBeInTheDocument();
  });
});
