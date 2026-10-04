import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMPOSER_GAP_PX, useStickyComposer } from './use-sticky-composer';

let composerHeight = 90;
let observed: (() => void) | null = null;

class FakeResizeObserver {
  constructor(callback: () => void) {
    observed = callback;
  }
  observe() {}
  disconnect() {
    observed = null;
  }
}

function Harness({ position }: { readonly position: 'sticky' | 'static' }) {
  const { composerRef, endRef } = useStickyComposer();
  return (
    <>
      <div ref={endRef} data-testid="end" />
      <div ref={composerRef} style={{ position }} />
    </>
  );
}

const padding = () => window.document.documentElement.style.scrollPaddingBottom;
const scrolledToEnd = () => vi.mocked(Element.prototype.scrollIntoView).mock.calls.length;

function scrollTo(distanceFromBottom: number) {
  Object.defineProperty(window.document.documentElement, 'scrollHeight', {
    configurable: true,
    value: 3000,
  });
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    value: 3000 - window.innerHeight - distanceFromBottom,
  });
  window.dispatchEvent(new Event('scroll'));
}

beforeEach(() => {
  composerHeight = 90;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => composerHeight);
  vi.mocked(Element.prototype.scrollIntoView).mockClear();
});

afterEach(() => {
  window.document.documentElement.style.removeProperty('scroll-padding-bottom');
});

describe('useStickyComposer', () => {
  it('keeps scrolling and focus clear of a sticky composer: its height plus a gap', () => {
    render(<Harness position="sticky" />);

    expect(padding()).toBe(`${90 + COMPOSER_GAP_PX}px`);
  });

  it('follows the composer when it grows, such as when an error appears above the box', () => {
    render(<Harness position="sticky" />);

    composerHeight = 160;
    act(() => observed?.());

    expect(padding()).toBe(`${160 + COMPOSER_GAP_PX}px`);
  });

  it('covers nothing, so clears nothing, when the screen is so short that the composer is static', () => {
    render(<Harness position="static" />);

    expect(padding()).toBe(`${COMPOSER_GAP_PX}px`);
  });

  it('puts the page back as it was when the thread goes away', () => {
    const { unmount } = render(<Harness position="sticky" />);

    unmount();

    expect(padding()).toBe('');
  });

  it('keeps the end of the thread in view when the composer grows and the reader is at the bottom', () => {
    render(<Harness position="sticky" />);
    scrollTo(30);
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    composerHeight = 160;
    act(() => observed?.());

    expect(scrolledToEnd()).toBe(1);
  });

  it('leaves a reader who scrolled up where they are when the composer grows', () => {
    render(<Harness position="sticky" />);
    scrollTo(900);
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    composerHeight = 160;
    act(() => observed?.());

    expect(scrolledToEnd()).toBe(0);
  });

  it('counts "at the bottom" from the composer height, so a taller composer does not unpin the view', () => {
    composerHeight = 300;
    render(<Harness position="sticky" />);
    scrollTo(300 + 90);
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    composerHeight = 310;
    act(() => observed?.());

    expect(scrolledToEnd()).toBe(1);
  });
});
