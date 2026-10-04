import Link from 'next/link';
import type { ReactNode } from 'react';

import { buttonClass } from './button';

/** Navigation that looks like a button: a link, because it goes somewhere. */
export function ButtonLink({
  href,
  size,
  children,
}: {
  readonly href: string;
  readonly size?: 'md' | 'sm';
  readonly children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass({ size })}>
      {children}
    </Link>
  );
}
