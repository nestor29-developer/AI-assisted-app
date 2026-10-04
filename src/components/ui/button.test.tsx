import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button';

describe('Button', () => {
  it('stays focusable while loading, so Chrome does not drop focus to the page', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Button>Add document</Button>);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Add document' })).toHaveFocus();

    rerender(<Button loading>Add document</Button>);

    const button = screen.getByRole('button', { name: 'Please wait…' });
    expect(button).toHaveFocus();
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('ignores clicks and does not submit its form while loading', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading onClick={onClick}>
          Save
        </Button>
      </form>,
    );

    await user.click(screen.getByRole('button'));
    await user.keyboard('{Enter}');

    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('runs its click handler and submits when it is not loading', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" onClick={onClick}>
          Save
        </Button>
      </form>,
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('is still really disabled when it is told to be', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Ask
      </Button>,
    );

    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('gives its element to a ref, so a caller can move focus to it', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Delete</Button>);

    expect(ref.current).toBe(screen.getByRole('button', { name: 'Delete' }));
  });

  it('keeps a border in every variant, so its shape survives forced colours', () => {
    render(
      <>
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="danger">Danger</Button>
      </>,
    );

    for (const button of screen.getAllByRole('button')) expect(button).toHaveClass('border');
  });
});
