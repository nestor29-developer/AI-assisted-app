import { describe, expect, it } from 'vitest';

import { InMemoryRateLimiter } from '@/test/fakes/rate-limiter';
import { InMemoryUserRepository } from '@/test/fakes/user-repository';

import { AuthService } from './auth.service';
import { createEmailKeyer } from './email-key';
import { createRequestAuthenticator } from './authenticator';
import { JwtTokenService } from './jwt';
import { Argon2PasswordHasher } from './password';
import { SessionCookies } from './session-cookie';

describe('createRequestAuthenticator', () => {
  const cookies = new SessionCookies(false, 3600);
  const service = new AuthService({
    users: new InMemoryUserRepository(),
    hasher: new Argon2PasswordHasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 }),
    tokens: new JwtTokenService('s'.repeat(32), 3600),
    rateLimiter: new InMemoryRateLimiter(),
    attemptsPerMinute: 10,
    emailKey: createEmailKeyer('test-secret-for-email-keys-0123456789'),
  });
  const authenticate = createRequestAuthenticator(cookies, service);
  const request = (cookie?: string) =>
    new Request('http://localhost/x', cookie ? { headers: { cookie } } : {});

  it('resolves the user from a valid session cookie', async () => {
    const { user, token } = await service.register(
      { email: 'alice@example.com', password: 'a-long-enough-password' },
      { clientIp: '203.0.113.9' },
    );

    expect(await authenticate(request(`session=${token}`))).toEqual(user);
  });

  it('treats a missing, forged or foreign-named cookie as signed out', async () => {
    expect(await authenticate(request())).toBeNull();
    expect(await authenticate(request('session=forged.token.value'))).toBeNull();
    expect(await authenticate(request('other=abc'))).toBeNull();
  });
});
