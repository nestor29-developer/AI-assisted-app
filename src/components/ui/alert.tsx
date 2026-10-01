import type { ReactNode } from 'react';

const TONES = {
  error: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-slate-200 bg-slate-50 text-slate-700',
} as const;

export function Alert({
  tone = 'info',
  children,
}: {
  readonly tone?: keyof typeof TONES;
  readonly children: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-3 py-2 text-sm ${TONES[tone]}`}
    >
      {children}
    </div>
  );
}
