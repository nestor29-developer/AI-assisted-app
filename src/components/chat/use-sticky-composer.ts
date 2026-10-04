'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/** Air kept between the last line of the thread and the composer that sticks below it. */
export const COMPOSER_GAP_PX = 16;

/** Within this far of the composer's own height from the bottom, new text keeps the view at the bottom. */
const PIN_SLACK_PX = 96;

/** The sticky composer covers the thread's end, so the page's scroll-padding follows its height. */
export function useStickyComposer() {
  const composerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const clearance = useRef(0);
  const pinned = useRef(true);

  const followEnd = useCallback(() => {
    if (pinned.current) endRef.current?.scrollIntoView({ block: 'end' });
  }, []);
  const pin = useCallback(() => {
    pinned.current = true;
  }, []);

  useLayoutEffect(() => {
    const element = composerRef.current;
    if (!element) return;
    const root = document.documentElement;

    // On a short screen the composer is static and covers nothing.
    const measure = () => {
      const covering = getComputedStyle(element).position === 'sticky';
      const before = clearance.current;
      clearance.current = covering ? element.offsetHeight : 0;
      root.style.scrollPaddingBottom = `${clearance.current + COMPOSER_GAP_PX}px`;
      return clearance.current !== before;
    };
    const onResize = () => {
      if (measure()) followEnd();
    };

    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    observer?.observe(element);
    window.addEventListener('resize', onResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', onResize);
      root.style.removeProperty('scroll-padding-bottom');
      clearance.current = 0;
    };
  }, [followEnd]);

  useEffect(() => {
    const onScroll = () => {
      const distance =
        document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
      pinned.current = distance <= clearance.current + PIN_SLACK_PX;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return { composerRef, endRef, pin, followEnd };
}
