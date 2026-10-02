import { Button } from '@/components/ui/button';

type Rating = 'up' | 'down';

const PRESSED = 'aria-pressed:border-indigo-300 aria-pressed:bg-indigo-50';

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
      <span role="status" className="text-xs text-slate-600">
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
        <span aria-hidden="true">👍</span>
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
        <span aria-hidden="true">👎</span>
      </Button>
    </div>
  );
}
