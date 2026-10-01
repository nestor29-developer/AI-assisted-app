import { describe, expect, it } from 'vitest';

import { ConcurrencyLimiter } from '@/server/core/concurrency';
import { ServiceBusyError } from '@/server/core/errors';

import { Argon2PasswordHasher, OWASP_ARGON2_PARAMS } from './password';

// Cheap parameters keep the suite fast; the production profile is asserted separately below.
const hasher = new Argon2PasswordHasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });

describe('Argon2PasswordHasher', () => {
  it('produces argon2id hashes that verify only the right password', async () => {
    const hash = await hasher.hash('correct horse battery staple');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await hasher.verify(hash, 'correct horse battery staple')).toBe(true);
    expect(await hasher.verify(hash, 'wrong password')).toBe(false);
  });

  it('salts every hash, so equal passwords never produce equal hashes', async () => {
    const [a, b] = await Promise.all([hasher.hash('same-password'), hasher.hash('same-password')]);
    expect(a).not.toBe(b);
  });

  it('treats a malformed stored hash as a failed verification instead of throwing', async () => {
    expect(await hasher.verify('not-a-hash', 'whatever')).toBe(false);
  });

  it('sheds load with a 503 instead of queueing hashes without bound', async () => {
    const crowded = new Argon2PasswordHasher(
      { memoryCost: 1024, timeCost: 1, parallelism: 1 },
      new ConcurrencyLimiter(1, 0),
    );

    const running = crowded.hash('first');
    const rejected = crowded.hash('second');

    await expect(rejected).rejects.toBeInstanceOf(ServiceBusyError);
    await expect(running).resolves.toMatch(/^\$argon2id\$/);
  });

  it('ships OWASP-minimum parameters in production', async () => {
    expect(OWASP_ARGON2_PARAMS).toEqual({ memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    const hash = await new Argon2PasswordHasher().hash('x');
    expect(hash).toContain('m=19456,t=2,p=1');
  });
});
