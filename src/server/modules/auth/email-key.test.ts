import { describe, expect, it } from 'vitest';

import { createEmailKeyer } from './email-key';

describe('createEmailKeyer', () => {
  const key = createEmailKeyer('a-server-side-secret-of-some-length');

  it('is deterministic and produces a fixed-length hex digest', () => {
    expect(key('alice@example.com')).toBe(key('alice@example.com'));
    expect(key('alice@example.com')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates emails and never contains the input', () => {
    expect(key('alice@example.com')).not.toBe(key('bob@example.com'));
    expect(key('alice@example.com')).not.toContain('alice');
  });

  it('cannot be reproduced without the secret (a plain sha256 dictionary will not match)', () => {
    const other = createEmailKeyer('a-different-secret-of-some-length!!');
    expect(other('alice@example.com')).not.toBe(key('alice@example.com'));
  });
});
