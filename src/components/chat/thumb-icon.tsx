/** A thumb that is solid when chosen and an outline when not, so the choice does not rest on colour alone. */
export function ThumbIcon({
  direction,
  filled,
}: {
  readonly direction: 'up' | 'down';
  readonly filled: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className={`size-4 ${direction === 'down' ? 'rotate-180' : ''}`}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 10.5H7V20.3H3.5a1 1 0 0 1-1-1V11.5a1 1 0 0 1 1-1z" />
      <path d="M7 10.5L10.2 3.6A1.7 1.7 0 0 1 13.2 4.9L12.6 9H19A2 2 0 0 1 21 11.3L19.9 18.6A2 2 0 0 1 17.9 20.3H7z" />
    </svg>
  );
}
