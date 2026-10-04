import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Composer, STOP_ARMS_AFTER_MS } from './composer';

function setup(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const props = {
    value: 'How many days?',
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onStop: vi.fn(),
    busy: false,
    disabled: false,
    inputRef: createRef<HTMLTextAreaElement>(),
    ...overrides,
  };
  const view = render(<Composer {...props} />);
  return { ...props, ...view };
}

afterEach(() => vi.useRealTimers());

describe('Composer: Ask and Stop', () => {
  it('shows Stop as a new button, not as the Ask button turned into one', () => {
    const { rerender, ...props } = setup();
    const ask = screen.getByRole('button', { name: 'Ask' });

    rerender(<Composer {...props} busy />);

    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop).not.toBe(ask);
    expect(ask).not.toBeInTheDocument();
  });

  it('ignores a press that comes straight after Stop appears, and obeys one that comes later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const user = userEvent.setup({ advanceTimers: () => undefined });
    const { onStop } = setup({ busy: true });
    const stop = screen.getByRole('button', { name: 'Stop' });

    vi.setSystemTime(Date.now() + STOP_ARMS_AFTER_MS - 1);
    await user.click(stop);
    expect(onStop).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + 2);
    await user.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('gives Ask and Stop the same minimum width, so the question box does not shift between them', () => {
    const { rerender, ...props } = setup();
    expect(screen.getByRole('button', { name: 'Ask' })).toHaveClass('min-w-16');

    rerender(<Composer {...props} busy />);

    expect(screen.getByRole('button', { name: 'Stop' })).toHaveClass('min-w-16');
  });
});

describe('Composer: the Enter key', () => {
  it('sends on Enter and keeps Shift+Enter for a new line', () => {
    const { onSubmit } = setup();
    const box = screen.getByRole('textbox', { name: 'Your question' });

    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not send the Enter that confirms an input-method composition', () => {
    const { onSubmit } = setup();
    const box = screen.getByRole('textbox', { name: 'Your question' });

    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('Composer: how it looks and reads', () => {
  it('draws the question box with a border that can be seen', () => {
    setup();

    expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveClass('border-slate-500');
  });

  it('hides the Shift+Enter hint on touch screens, which have no Shift key to press', () => {
    setup();

    expect(screen.getByText(/Shift\+Enter for a new line/)).toHaveClass(
      '[@media(pointer:coarse)]:hidden',
    );
  });

  it('is a form with a name, so a screen reader can jump to it', () => {
    setup();

    expect(screen.getByRole('form', { name: 'Ask a question' })).toBeInTheDocument();
  });
});
