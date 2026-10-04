import type { ButtonHTMLAttributes, MouseEvent, Ref } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';
type Size = 'md' | 'sm';

/** Each variant sets its own border colour; two on one element are settled by stylesheet order. */
const VARIANTS: Record<Variant, string> = {
  primary:
    'border-transparent bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300 aria-disabled:bg-indigo-300',
  secondary:
    'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400 aria-disabled:text-slate-400',
  danger:
    'border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:text-red-300 aria-disabled:text-red-300',
};

/** Same 14px text at both sizes; only the height and padding change. */
const SIZES: Record<Size, string> = { md: 'h-10 px-4', sm: 'h-8 px-3' };

/** The look of a button, for a link that should read as one. */
export function buttonClass({
  variant = 'primary',
  size = 'md',
  className = '',
}: {
  readonly variant?: Variant;
  readonly size?: Size;
  readonly className?: string;
}): string {
  return `inline-flex items-center justify-center gap-1.5 rounded-lg border text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed aria-disabled:cursor-not-allowed ${SIZES[size]} ${VARIANTS[variant]} ${className}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant;
  readonly size?: Size;
  readonly loading?: boolean;
  readonly ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  children,
  disabled,
  onClick,
  ...rest
}: ButtonProps) {
  // Chrome drops focus from a button that turns disabled, so a loading one stays focusable and ignores clicks.
  function onGuardedClick(event: MouseEvent<HTMLButtonElement>) {
    if (loading) event.preventDefault();
    else onClick?.(event);
  }

  return (
    <button
      {...rest}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={onGuardedClick}
      className={buttonClass({ variant, size, className })}
    >
      {loading ? 'Please wait…' : children}
    </button>
  );
}
