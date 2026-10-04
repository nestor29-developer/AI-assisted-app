import { useId, type TextareaHTMLAttributes } from 'react';

interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | undefined;
}

export function TextArea({ label, hint, error, className = '', ...rest }: TextAreaProps) {
  const id = useId();
  // The hint gives way to the error, so only what is on screen is referenced.
  const showHint = Boolean(hint) && !error;
  const describedBy = [showHint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <textarea
        {...rest}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-indigo-600 ${error ? 'border-red-500' : 'border-slate-500'} ${className}`}
      />
      {showHint ? (
        <p id={`${id}-hint`} className="text-xs text-slate-600">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
