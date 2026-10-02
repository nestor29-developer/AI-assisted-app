import { ApiError } from '@google/genai';

import { AiProviderError } from './errors';

const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
]);

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

/** Google puts a retry hint in the error body: ... "retryDelay": "28s" ... */
export function parseRetryDelayMs(message: string): number | undefined {
  const seconds = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message)?.[1];
  return seconds === undefined ? undefined : Math.ceil(Number(seconds) * 1000);
}

function hasNetworkCode(error: Error): boolean {
  const cause = (error as { cause?: { code?: unknown } }).cause;
  return typeof cause?.code === 'string' && NETWORK_ERROR_CODES.has(cause.code);
}

/** Classifies a failure as retryable or not; aborts pass through for the caller to handle. */
export function mapGeminiError(error: unknown): unknown {
  if (isAbortError(error)) return error;

  if (error instanceof ApiError) {
    const retryAfterMs = parseRetryDelayMs(error.message);
    return new AiProviderError(`Gemini request failed with status ${error.status}`, {
      retryable: error.status === 429 || error.status === 408 || error.status >= 500,
      status: error.status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      cause: error,
    });
  }
  if (error instanceof TypeError || (error instanceof Error && hasNetworkCode(error))) {
    return new AiProviderError('Could not reach the Gemini API', { retryable: true, cause: error });
  }
  return error;
}
