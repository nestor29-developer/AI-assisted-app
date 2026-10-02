/** A placeholder block for content that is loading; hidden from screen readers, which hear the status text. */
export function Skeleton({ className = '' }: { readonly className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-lg bg-slate-200 motion-safe:animate-pulse ${className}`}
    />
  );
}
