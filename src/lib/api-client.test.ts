import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { apiFetch, apiSend, ApiError } from './api-client';
import { describeError, describeErrorCode, describeFailedReply } from './api-errors';

const schema = z.object({ ok: z.literal(true) });

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const problem = (body: object, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

afterEach(() => vi.unstubAllGlobals());

describe('apiFetch', () => {
  it('returns the body validated against the schema and sends JSON with cookies', async () => {
    const fetchMock = stubFetch(Response.json({ ok: true }));

    const result = await apiFetch('/api/v1/x', schema, { method: 'POST', json: { a: 1 } });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/x',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: '{"a":1}' }),
    );
  });

  it('sends a multipart body without a content type, so the browser can add the boundary', async () => {
    const fetchMock = stubFetch(Response.json({ ok: true }));
    const form = new FormData();
    form.set('file', new File(['hello'], 'a.txt'));

    await apiFetch('/api/v1/x', schema, { method: 'POST', form });

    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body).toBe(form);
    expect(new Headers(init.headers).has('content-type')).toBe(false);
  });

  it('turns a problem+json response into a typed ApiError', async () => {
    stubFetch(
      problem(
        {
          type: 'urn:problem:rate-limited',
          title: 'Too many requests',
          status: 429,
          code: 'RATE_LIMITED',
          detail: 'Slow down.',
          retryAfterSeconds: 30,
        },
        429,
      ),
    );

    const error = await apiFetch('/api/v1/x', schema).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Slow down.',
      retryAfterSeconds: 30,
    });
  });

  it('keeps field-level validation issues', async () => {
    stubFetch(
      problem(
        {
          type: 'urn:problem:validation-error',
          title: 'Validation failed',
          status: 400,
          code: 'VALIDATION_ERROR',
          errors: [{ path: 'email', message: 'Invalid email' }],
        },
        400,
      ),
    );

    const error = (await apiFetch('/api/v1/x', schema).catch((e: unknown) => e)) as ApiError;

    expect(error.issues).toEqual([{ path: 'email', message: 'Invalid email' }]);
  });

  it('reports network failures separately from server errors', async () => {
    stubFetch(new TypeError('fetch failed'));

    await expect(apiFetch('/api/v1/x', schema)).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
  });

  it('never trusts a success body that does not match the contract', async () => {
    stubFetch(Response.json({ ok: false }));

    await expect(apiFetch('/api/v1/x', schema)).rejects.toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
    });
  });

  it('survives non-JSON error bodies such as a proxy HTML page', async () => {
    stubFetch(new Response('<html>Bad gateway</html>', { status: 502 }));

    await expect(apiFetch('/api/v1/x', schema)).rejects.toMatchObject({
      status: 502,
      code: 'UNEXPECTED_RESPONSE',
    });
  });
});

describe('apiSend', () => {
  it('accepts 204 No Content', async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(apiSend('/api/v1/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });
});

describe('describeError', () => {
  it('explains rate limits with a human-readable wait', () => {
    expect(describeError(new ApiError(429, 'RATE_LIMITED', 'x', 30))).toContain('30 seconds');
    expect(describeError(new ApiError(429, 'RATE_LIMITED', 'x', 90))).toContain('2 minutes');
    expect(describeError(new ApiError(429, 'RATE_LIMITED', 'x', 1))).toContain('1 second.');
  });

  it('passes through server messages for ordinary errors and hides unknown ones', () => {
    expect(
      describeError(new ApiError(409, 'CONFLICT', 'An account with this email already exists.')),
    ).toBe('An account with this email already exists.');
    expect(describeError(new Error('boom: stack trace'))).toBe(
      'Something went wrong. Please try again.',
    );
  });
});

describe('describeErrorCode and describeFailedReply', () => {
  it.each([
    ['AI_UNAVAILABLE', 'not responding'],
    ['SERVICE_BUSY', 'busy'],
    ['QUOTA_EXCEEDED', 'usage limit'],
    ['UNAUTHENTICATED', 'sign in again'],
    ['INTERNAL', 'our side'],
  ])('has its own wording for %s', (code, fragment) => {
    expect(describeErrorCode(code)).toContain(fragment);
  });

  it('leaves codes whose server message is already good to the server', () => {
    expect(describeErrorCode('CONFLICT')).toBeNull();
    expect(describeErrorCode('PDF_NO_TEXT_LAYER')).toBeNull();
  });

  it('rebuilds the explanation for a stored failed reply from its code alone', () => {
    expect(describeFailedReply('AI_UNAVAILABLE')).toContain('not responding');
    expect(describeFailedReply('SOMETHING_NEW')).toBe(
      'The answer could not be completed. Please try again.',
    );
    expect(describeFailedReply(null)).toBe('The answer could not be completed. Please try again.');
  });
});
