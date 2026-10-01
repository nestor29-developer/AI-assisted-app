import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { JwtTokenService } from './jwt';

const SECRET = 'a'.repeat(32);
const user = { id: '3f8d9f0e-8d3e-4a38-9d63-0e5a0f9a7c11', email: 'alice@example.com' };
const key = (secret: string) => new TextEncoder().encode(secret);

describe('JwtTokenService', () => {
  it('round-trips a session user', async () => {
    const service = new JwtTokenService(SECRET, 3600);
    expect(await service.verify(await service.issue(user))).toEqual(user);
  });

  it('rejects tokens signed with a different secret', async () => {
    const token = await new JwtTokenService('b'.repeat(32), 3600).issue(user);
    expect(await new JwtTokenService(SECRET, 3600).verify(token)).toBeNull();
  });

  it('rejects expired tokens and honours the small clock tolerance', async () => {
    let now = new Date('2026-01-01T00:00:00Z');
    const service = new JwtTokenService(SECRET, 60, () => now);
    const token = await service.issue(user);

    now = new Date('2026-01-01T00:01:03Z');
    expect(await service.verify(token)).toEqual(user);
    now = new Date('2026-01-01T00:01:10Z');
    expect(await service.verify(token)).toBeNull();
  });

  it('pins the algorithm: HS512 tokens signed with the right secret are refused', async () => {
    const forged = await new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject(user.id)
      .setIssuer('ai-document-qa')
      .setAudience('ai-document-qa:web')
      .setExpirationTime('1h')
      .sign(key(SECRET));
    expect(await new JwtTokenService(SECRET, 3600).verify(forged)).toBeNull();
  });

  it('refuses unsigned (alg=none) tokens', async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
      sub: user.id,
      email: user.email,
      iss: 'ai-document-qa',
      aud: 'ai-document-qa:web',
      exp: 4_102_444_800,
    })}.`;
    expect(await new JwtTokenService(SECRET, 3600).verify(unsigned)).toBeNull();
  });

  it('refuses a correctly signed token that has no expiry', async () => {
    const eternal = await new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer('ai-document-qa')
      .setAudience('ai-document-qa:web')
      .setIssuedAt()
      .sign(key(SECRET));
    expect(await new JwtTokenService(SECRET, 3600).verify(eternal)).toBeNull();
  });

  it.each([
    ['wrong issuer', { iss: 'someone-else', aud: 'ai-document-qa:web' }],
    ['wrong audience', { iss: 'ai-document-qa', aud: 'another-app' }],
  ])('rejects a token with the %s', async (_label, { iss, aud }) => {
    const token = await new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(iss)
      .setAudience(aud)
      .setExpirationTime('1h')
      .sign(key(SECRET));
    expect(await new JwtTokenService(SECRET, 3600).verify(token)).toBeNull();
  });

  it('rejects well-signed tokens whose claims have the wrong shape', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('not-a-uuid')
      .setIssuer('ai-document-qa')
      .setAudience('ai-document-qa:web')
      .setExpirationTime('1h')
      .sign(key(SECRET));
    expect(await new JwtTokenService(SECRET, 3600).verify(token)).toBeNull();
  });

  it.each(['', 'garbage', 'a.b.c'])('treats %j as not signed in', async (token) => {
    expect(await new JwtTokenService(SECRET, 3600).verify(token)).toBeNull();
  });
});
