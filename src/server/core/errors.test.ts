import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { problemSchema } from '@/shared/contracts/problem';

import {
  AppError,
  InternalError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
  normalizeError,
} from './errors';
import { problemResponse } from './http/problem';

const context = { requestId: 'req-12345678', instance: '/api/v1/things' };

describe('normalizeError', () => {
  it('passes AppErrors through untouched', () => {
    const error = new NotFoundError('Document');
    expect(normalizeError(error)).toBe(error);
  });

  it('turns ZodErrors into a 400 with dotted field paths', () => {
    const result = z
      .object({ user: z.object({ email: z.email() }) })
      .safeParse({ user: { email: 'nope' } });
    if (result.success) throw new Error('expected failure');

    const error = normalizeError(result.error);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.status).toBe(400);
    expect(error.issues?.[0]?.path).toBe('user.email');
  });

  it('wraps unknown errors as a generic 500 and keeps the original as the cause', () => {
    const original = new Error('connection to db password=hunter2 failed');
    const error = normalizeError(original);

    expect(error).toBeInstanceOf(InternalError);
    expect(error.status).toBe(500);
    expect(error.cause).toBe(original);
    expect(error.detail).not.toContain('hunter2');
  });

  it('sets the subclass name for readable logs', () => {
    expect(new NotFoundError().name).toBe('NotFoundError');
    expect(new NotFoundError()).toBeInstanceOf(AppError);
  });
});

describe('problemResponse', () => {
  it('renders an RFC 9457 body that the shared contract accepts', async () => {
    const response = problemResponse(new NotFoundError('Document'), context);
    const body = problemSchema.parse(await response.json());

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toMatchObject({
      type: 'urn:problem:not-found',
      code: 'NOT_FOUND',
      requestId: context.requestId,
      instance: context.instance,
    });
  });

  it('sets Retry-After and retryAfterSeconds together for rate limits', async () => {
    const response = problemResponse(new RateLimitedError(30), context);
    const body = problemSchema.parse(await response.json());

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(body.retryAfterSeconds).toBe(30);
  });

  it('never leaks internal error details', async () => {
    const response = problemResponse(normalizeError(new Error('secret stack info')), context);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain('secret stack info');
  });
});
