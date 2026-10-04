import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TextArea } from './text-area';
import { TextField } from './text-field';

const referenced = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => window.document.getElementById(id));

describe.each([
  ['TextField', (props: object) => <TextField label="Password" {...props} />],
  ['TextArea', (props: object) => <TextArea label="Password" {...props} />],
])('%s', (_name, field) => {
  it('is described by its hint', () => {
    render(field({ hint: 'At least 10 characters.' }));

    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
      'At least 10 characters.',
    );
  });

  it('is described by its error instead, and points only at text that is on the page', () => {
    render(field({ hint: 'At least 10 characters.', error: 'Use at least 10 characters.' }));

    const input = screen.getByLabelText('Password');
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription('Use at least 10 characters.');
    expect(referenced(input).every((element) => element !== null)).toBe(true);
    expect(screen.queryByText('At least 10 characters.')).not.toBeInTheDocument();
  });

  it('points at nothing when it has neither', () => {
    render(field({}));

    expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-describedby');
  });

  it('has a border dark enough to see, and a red one when it is in error', () => {
    const { rerender } = render(field({}));
    expect(screen.getByLabelText('Password')).toHaveClass('border-slate-500');

    rerender(field({ error: 'Required.' }));

    expect(screen.getByLabelText('Password')).toHaveClass('border-red-500');
  });
});
