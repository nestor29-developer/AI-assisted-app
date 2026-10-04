import { act, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LiveStatus, useAnnouncer } from './live-status';

describe('LiveStatus', () => {
  it('is a polite status region that people using a screen reader hear and others do not see', () => {
    render(<LiveStatus message="Saved" />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Saved');
    expect(status).toHaveClass('sr-only');
  });

  it('is present, and empty, before it has anything to say', () => {
    render(<LiveStatus message="" />);

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});

describe('useAnnouncer', () => {
  it('changes the message each time, even for the same sentence twice in a row', () => {
    const { result } = renderHook(() => useAnnouncer());

    act(() => result.current.announce('Deleted'));
    const first = result.current.message;
    act(() => result.current.announce('Deleted'));
    const second = result.current.message;
    act(() => result.current.announce('Deleted'));
    const third = result.current.message;

    expect(first).not.toBe(second);
    expect(second).not.toBe(third);
    for (const message of [first, second, third]) expect(message.trim()).toBe('Deleted');
  });
});
