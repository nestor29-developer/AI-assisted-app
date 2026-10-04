const BASE =
  'inline-flex min-w-6 items-center justify-center rounded px-1 py-0.5 text-xs font-medium';

/** A source id looks the same inline in the answer and in the Sources list; slate marks one that cannot be opened. */
export const SOURCE_TAG = {
  known: `${BASE} bg-indigo-50 text-indigo-700`,
  unknown: `${BASE} bg-slate-100 text-slate-600`,
} as const;
