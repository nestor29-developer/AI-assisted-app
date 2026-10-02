import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AnswerText } from './answer-text';

const handlers = (knownIds: string[], openIds: string[] = [], onSelect = vi.fn()) => ({
  knownIds: new Set(knownIds),
  openIds: new Set(openIds),
  onSelect,
});

describe('AnswerText', () => {
  it('turns markers for known sources into buttons that report which source was picked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <AnswerText
        text="Days accrue monthly [S1]. Remote work needs approval [S2, S3]."
        markers={handlers(['S1', 'S2'], ['S2'], onSelect)}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Show source S1' }));
    expect(onSelect).toHaveBeenCalledWith('S1');
    expect(screen.getByRole('button', { name: 'Show source S1' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Show source S2' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('shows a marker for a source it does not have as plain text, not as a broken button', () => {
    render(<AnswerText text="Claimed by [S9]." markers={handlers(['S1'])} />);

    expect(screen.getByText('S9')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows markers as plain text while an answer is still being written', () => {
    render(<AnswerText text="So far [S1]" />);

    expect(screen.getByText('S1')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps the text around the markers, in order, and preserves line breaks', () => {
    const { container } = render(
      <AnswerText text={'First line [S1]\nSecond line'} markers={handlers(['S1'])} />,
    );

    expect(container.querySelector('p')?.textContent).toBe('First line S1\nSecond line');
    expect(container.querySelector('p')).toHaveClass('whitespace-pre-wrap');
  });
});
