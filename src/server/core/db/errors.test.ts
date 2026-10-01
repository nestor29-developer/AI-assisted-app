import { describe, expect, it } from 'vitest';

import { hasPgErrorCode, PG_UNIQUE_VIOLATION } from './errors';

describe('hasPgErrorCode', () => {
  it('finds the SQLSTATE on the error itself', () => {
    expect(hasPgErrorCode({ code: '23505' }, PG_UNIQUE_VIOLATION)).toBe(true);
  });

  it('finds it through drizzle-style wrapping in `cause`', () => {
    const wrapped = new Error('Failed query', {
      cause: { code: '23505', constraint: 'users_email_unique' },
    });
    expect(hasPgErrorCode(wrapped, PG_UNIQUE_VIOLATION)).toBe(true);
  });

  it.each([[null], [undefined], ['23505'], [{ code: '42P01' }], [new Error('plain')]])(
    'is false for %j',
    (value) => {
      expect(hasPgErrorCode(value, PG_UNIQUE_VIOLATION)).toBe(false);
    },
  );

  it('stops on circular cause chains', () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(hasPgErrorCode(loop, PG_UNIQUE_VIOLATION)).toBe(false);
  });
});
