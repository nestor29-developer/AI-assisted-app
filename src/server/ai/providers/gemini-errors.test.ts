import { ApiError } from '@google/genai';
import { describe, expect, it } from 'vitest';

import { AiProviderError } from './errors';
import { mapGeminiError, parseRetryDelayMs } from './gemini-errors';

describe('parseRetryDelayMs', () => {
  it.each([
    ['{"error":{"details":[{"retryDelay":"28s"}]}}', 28_000],
    ['... "retryDelay": "1.5s" ...', 1_500],
    ['no hint here', undefined],
    ['"retryDelay":"soon"', undefined],
  ])('reads %j as %s', (message, expected) => {
    expect(parseRetryDelayMs(message)).toBe(expected);
  });
});

describe('mapGeminiError', () => {
  it.each([
    [408, true],
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [403, false],
    [404, false],
  ])('treats HTTP %s as retryable=%s', (status, retryable) => {
    const mapped = mapGeminiError(new ApiError({ message: 'x', status }));

    expect(mapped).toBeInstanceOf(AiProviderError);
    expect(mapped).toMatchObject({ retryable, status });
  });

  it('treats network failures as retryable', () => {
    const reset = Object.assign(new Error('socket hang up'), { cause: { code: 'ECONNRESET' } });

    expect(mapGeminiError(new TypeError('fetch failed'))).toMatchObject({ retryable: true });
    expect(mapGeminiError(reset)).toMatchObject({ retryable: true });
  });

  it('passes aborts and timeouts through, and leaves unknown errors alone', () => {
    const abort = new DOMException('stop', 'AbortError');
    const timeout = new DOMException('deadline', 'TimeoutError');
    const unknown = new RangeError('programming mistake');

    expect(mapGeminiError(abort)).toBe(abort);
    expect(mapGeminiError(timeout)).toBe(timeout);
    expect(mapGeminiError(unknown)).toBe(unknown);
  });
});
