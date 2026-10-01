import { ApiError } from './api-client';

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** One place that turns any thrown value into a sentence a person can act on. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  switch (error.code) {
    case 'RATE_LIMITED':
    case 'TOO_MANY_CONCURRENT_REQUESTS':
      return error.retryAfterSeconds
        ? `Too many requests. Try again in ${formatWait(error.retryAfterSeconds)}.`
        : 'Too many requests. Please wait a moment and try again.';
    case 'QUOTA_EXCEEDED':
      return 'You have reached today’s AI usage limit. It frees up gradually over the next 24 hours.';
    case 'UNAUTHENTICATED':
      return 'Your session has expired. Please sign in again.';
    case 'INTERNAL':
      return 'Something went wrong on our side. Please try again.';
    default:
      return error.message;
  }
}
