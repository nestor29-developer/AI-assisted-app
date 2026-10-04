import { Button } from '@/components/ui/button';

import { ThumbIcon } from './thumb-icon';

type Rating = 'up' | 'down';

// An inset ring thickens the border without moving anything, and leaves the outline free for focus.
const PRESSED =
  'aria-pressed:border-indigo-600 aria-pressed:bg-indigo-50 aria-pressed:text-indigo-700 aria-pressed:ring-1 aria-pressed:ring-indigo-600 aria-pressed:ring-inset';

export function FeedbackButtons({
  value,
  disabled = false,
  onRate,
}: {
  readonly value: Rating | null;
  readonly disabled?: boolean;
  readonly onRate: (value: Rating) => void;
}) {
  return (
    <div role="group" aria-label="Rate this answer" className="ml-auto flex items-center gap-2">
      <span className="text-xs text-slate-600">
        {value ? 'Thanks for the feedback' : 'Was this helpful?'}
      </span>
      <Button
        variant="secondary"
        size="sm"
        aria-label="Helpful"
        aria-pressed={value === 'up'}
        disabled={disabled}
        onClick={() => onRate('up')}
        className={PRESSED}
      >
        <ThumbIcon direction="up" filled={value === 'up'} />
      </Button>
      <Button
        variant="secondary"
        size="sm"
        aria-label="Not helpful"
        aria-pressed={value === 'down'}
        disabled={disabled}
        onClick={() => onRate('down')}
        className={PRESSED}
      >
        <ThumbIcon direction="down" filled={value === 'down'} />
      </Button>
    </div>
  );
}
