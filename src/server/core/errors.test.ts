import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { problemSchema } from '@/shared/contracts/problem';

import {
  AppError,
  InternalError,
  NotFoundError,
  RateLimitedError,
  normalizeError,
  toLoggableError,
} from './errors';
import { problemResponse } from './http/problem';

const context = { requestId: 'req-12345678', instance: '/api/v1/things' };

describe('normalizeError', () => {
  it('passes AppErrors through untouched', () => {
    const error = new NotFoundError('Document');
    expect(normalizeError(error)).toBe(error);
  });

  it('treats a stray ZodError as a server bug (500), never as a client error', () => {
    const result = z.object({ answer: z.string() }).safeParse({ answer: 42 });
    if (result.success) throw new Error('expected failure');

    const error = normalizeError(result.error);

    expect(error).toBeInstanceOf(InternalError);
    expect(error.status).toBe(500);
    expect(error.issues).toBeUndefined();
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

describe('toLoggableError', () => {
  /** Mimics drizzle-orm's DrizzleQueryError: a wrapper whose message embeds the bound parameters. */
  class QueryWrapperError extends Error {
    constructor(cause: unknown) {
      super(
        'Failed query: insert into "users" ... params: alice@example.com,$argon2id$v=19$m=19456',
        { cause },
      );
      this.name = 'DrizzleQueryError';
    }
  }
  const pgError = Object.assign(new Error('connection terminated unexpectedly'), { code: '57P01' });

  it('reports the root cause and never the wrapper that carries query parameters', () => {
    const logged = toLoggableError(new InternalError(new QueryWrapperError(pgError)));

    expect(logged).toMatchObject({
      type: 'Error',
      message: 'connection terminated unexpectedly',
      code: '57P01',
    });
    expect(JSON.stringify(logged)).not.toContain('alice@example.com');
    expect(JSON.stringify(logged)).not.toContain('argon2id');
  });

  it('handles plain errors, non-error throwables and absurdly long messages', () => {
    expect(toLoggableError(new TypeError('boom'))).toMatchObject({
      type: 'TypeError',
      message: 'boom',
    });
    expect(toLoggableError('just a string')).toEqual({ type: 'string', message: 'just a string' });
    expect(toLoggableError(new Error('x'.repeat(5_000))).message).toHaveLength(1_000);
  });

  it('does not loop forever on circular cause chains', () => {
    const a: { cause?: unknown } = new Error('a');
    a.cause = a;
    expect(() => toLoggableError(a)).not.toThrow();
  });
});
