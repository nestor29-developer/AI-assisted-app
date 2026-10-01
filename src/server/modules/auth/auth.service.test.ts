import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConflictError, InvalidCredentialsError, RateLimitedError } from '@/server/core/errors';
import { InMemoryRateLimiter } from '@/test/fakes/rate-limiter';
import { InMemoryUserRepository } from '@/test/fakes/user-repository';

import { AuthService } from './auth.service';
import { createEmailKeyer } from './email-key';
import { JwtTokenService } from './jwt';
import { Argon2PasswordHasher, type PasswordHasher } from './password';

const context = { clientIp: '203.0.113.9' };
const registration = { email: 'alice@example.com', password: 'a-long-enough-password' };

function setup(attemptsPerMinute = 10) {
  const users = new InMemoryUserRepository();
  const rateLimiter = new InMemoryRateLimiter();
  const hasher = new Argon2PasswordHasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });
  const tokens = new JwtTokenService('s'.repeat(32), 3600);
  const emailKey = createEmailKeyer('test-secret-for-email-keys-0123456789');
  const service = new AuthService({
    users,
    hasher,
    tokens,
    rateLimiter,
    attemptsPerMinute,
    emailKey,
  });
  return { service, users, rateLimiter, hasher, tokens };
}

describe('AuthService.register', () => {
  it('creates the user, stores only a hash, and returns a verifiable session token', async () => {
    const { service, users, tokens } = setup();

    const { user, token } = await service.register(registration, context);

    expect(user.email).toBe('alice@example.com');
    expect(users.all).toHaveLength(1);
    expect(users.all[0]?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(users.all)).not.toContain(registration.password);
    expect(await tokens.verify(token)).toEqual(user);
  });

  it('refuses a duplicate email with a conflict', async () => {
    const { service } = setup();
    await service.register(registration, context);

    await expect(service.register(registration, context)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('AuthService.login', () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(async () => {
    ctx = setup();
    await ctx.service.register(registration, context);
  });

  it('signs in with the right password', async () => {
    const { user, token } = await ctx.service.login(registration, context);

    expect(user.email).toBe('alice@example.com');
    expect(await ctx.tokens.verify(token)).toEqual(user);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    // Settled together: awaiting one at a time leaves the other rejection briefly unhandled.
    const [wrongPassword, unknownEmail] = await Promise.allSettled([
      ctx.service.login({ ...registration, password: 'not-the-password' }, context),
      ctx.service.login({ email: 'nobody@example.com', password: 'whatever-it-is' }, context),
    ]);

    for (const outcome of [wrongPassword, unknownEmail]) {
      expect(outcome.status).toBe('rejected');
      expect((outcome as PromiseRejectedResult).reason).toBeInstanceOf(InvalidCredentialsError);
    }
    const detail = (outcome: PromiseSettledResult<unknown>) =>
      ((outcome as PromiseRejectedResult).reason as InvalidCredentialsError).detail;
    expect(detail(wrongPassword)).toBe(detail(unknownEmail));
  });

  it('still verifies a hash for unknown emails, so response time does not reveal accounts', async () => {
    const verify = vi.spyOn(ctx.hasher, 'verify');

    await expect(
      ctx.service.login({ email: 'nobody@example.com', password: 'whatever-it-is' }, context),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(verify).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService rate limiting', () => {
  it('blocks an IP after its attempts per window, with a retry hint', async () => {
    const { service } = setup(3);

    for (let i = 0; i < 3; i += 1) {
      await expect(
        service.login({ email: `user${i}@example.com`, password: 'wrong-password' }, context),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }

    const blocked = service.login(
      { email: 'user9@example.com', password: 'wrong-password' },
      context,
    );
    await expect(blocked).rejects.toBeInstanceOf(RateLimitedError);
    await expect(blocked).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: expect.any(Number),
    });
  });

  it('limits one email across many IPs more tightly than a single IP', async () => {
    const { service } = setup(10);
    const attempt = (ip: string) =>
      service.login(
        { email: 'victim@example.com', password: 'guess-guess-guess' },
        { clientIp: ip },
      );

    for (let i = 1; i <= 5; i += 1) {
      await expect(attempt(`198.51.100.${i}`)).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    await expect(attempt('198.51.100.99')).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('never stores raw emails in limiter keys', async () => {
    const { service, rateLimiter } = setup();

    await expect(
      service.login({ email: 'secret.person@example.com', password: 'wrong-password' }, context),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(rateLimiter.keys.join()).not.toContain('secret.person');
  });

  it('does not apply a per-email cap to registration', async () => {
    const { service, rateLimiter } = setup();
    await service.register(registration, context);
    expect(rateLimiter.keys.some((key) => key.startsWith('auth:email:'))).toBe(false);
  });
});

describe('AuthService dummy hash', () => {
  it('recovers if the first attempt to create it fails, instead of caching the failure', async () => {
    const users = new InMemoryUserRepository();
    const real = new Argon2PasswordHasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });
    let failures = 1;
    const hasher: PasswordHasher = {
      hash: (plain) =>
        failures-- > 0 ? Promise.reject(new Error('threadpool exhausted')) : real.hash(plain),
      verify: (storedHash, plain) => real.verify(storedHash, plain),
    };
    const service = new AuthService({
      users,
      hasher,
      tokens: new JwtTokenService('s'.repeat(32), 3600),
      rateLimiter: new InMemoryRateLimiter(),
      attemptsPerMinute: 10,
      emailKey: createEmailKeyer('test-secret-for-email-keys-0123456789'),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    await expect(
      service.login({ email: 'nobody@example.com', password: 'whatever-it-is' }, context),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});

describe('AuthService.authenticate', () => {
  it('returns the user for a valid token and null for junk', async () => {
    const { service } = setup();
    const { user, token } = await service.register(registration, context);

    expect(await service.authenticate(token)).toEqual(user);
    expect(await service.authenticate('junk')).toBeNull();
  });
});
