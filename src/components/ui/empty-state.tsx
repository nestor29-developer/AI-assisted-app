import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  titleAs: Title = 'h2',
  children,
}: {
  readonly title: string;
  readonly description: string;
  /** A page that shows nothing else needs its title to be the level-one heading. */
  readonly titleAs?: 'h1' | 'h2';
  readonly children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <Title className="text-base font-semibold text-slate-900">{title}</Title>
      <p className="mx-auto mt-1 max-w-md text-sm text-balance text-slate-600">{description}</p>
      {children ? <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
}
