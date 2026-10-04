/** A suggested question, shown the same way as a starter and as a follow-up. */
export function SuggestionChip({
  question,
  disabled = false,
  onAsk,
}: {
  readonly question: string;
  readonly disabled?: boolean;
  readonly onAsk: (question: string) => void;
}) {
  // One line is exactly as tall as a small button (32px); a longer question wraps and grows.
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onAsk(question)}
      className="inline-flex min-h-8 items-center rounded-lg border border-slate-300 bg-white px-3 py-1 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:text-slate-400"
    >
      {question}
    </button>
  );
}
