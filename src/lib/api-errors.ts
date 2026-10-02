import { ApiError } from './api-client';

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** Copy for codes where our wording beats the server's; null means the server's own message is fine. */
export function describeErrorCode(code: string, retryAfterSeconds?: number): string | null {
  switch (code) {
    case 'RATE_LIMITED':
    case 'TOO_MANY_CONCURRENT_REQUESTS':
      return retryAfterSeconds
        ? `Too many requests. Try again in ${formatWait(retryAfterSeconds)}.`
        : 'Too many requests. Please wait a moment and try again.';
    case 'QUOTA_EXCEEDED':
      return 'You have reached today’s AI usage limit. It frees up gradually over the next 24 hours.';
    case 'UNAUTHENTICATED':
      return 'Your session has expired. Please sign in again.';
    case 'AI_UNAVAILABLE':
      return 'The AI service is not responding right now. Please try again in a moment.';
    case 'SERVICE_BUSY':
      return 'The server is busy right now. Please try again in a moment.';
    case 'INTERNAL':
      return 'Something went wrong on our side. Please try again.';
    default:
      return null;
  }
}

/** One place that turns any thrown value into a sentence a person can act on. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  return describeErrorCode(error.code, error.retryAfterSeconds) ?? error.message;
}

/** A reply that failed was stored with only its code, so the explanation is rebuilt from that. */
export const describeFailedReply = (code: string | null): string =>
  (code ? describeErrorCode(code) : null) ?? 'The answer could not be completed. Please try again.';
