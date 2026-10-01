import { errors, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

import type { SessionUser } from '@/server/core/session';

const ISSUER = 'ai-document-qa';
const AUDIENCE = 'ai-document-qa:web';
const CLOCK_TOLERANCE_SECONDS = 5;

const claimsSchema = z.object({ sub: z.uuid(), email: z.string().min(3) });

export interface TokenService {
  issue(user: SessionUser): Promise<string>;
  verify(token: string): Promise<SessionUser | null>;
}

/** HS256 with the algorithm pinned on verify, so `none` and algorithm-confusion tokens fail. */
export class JwtTokenService implements TokenService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  issue(user: SessionUser): Promise<string> {
    const issuedAt = Math.floor(this.now().getTime() / 1000);
    return new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + this.ttlSeconds)
      .sign(this.key);
  }

  async verify(token: string): Promise<SessionUser | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
        currentDate: this.now(),
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['exp', 'iat', 'sub'],
      });
      const claims = claimsSchema.safeParse(payload);
      return claims.success ? { id: claims.data.sub, email: claims.data.email } : null;
    } catch (error) {
      if (error instanceof errors.JOSEError) return null;
      throw error;
    }
  }
}
