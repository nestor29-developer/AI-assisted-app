import { randomUUID } from 'node:crypto';

import { ConflictError, InvalidCredentialsError } from '@/server/core/errors';
import type { SessionUser } from '@/server/core/session';
import type { LoginRequest, RegisterRequest } from '@/shared/contracts/auth';
import { enforceRateLimit, type RateLimiter } from '@/server/modules/usage/rate-limiter';

import type { TokenService } from './jwt';
import type { PasswordHasher } from './password';
import { DuplicateEmailError, type UserRecord, type UserRepository } from './user.repository';

export interface AuthServiceDeps {
  readonly users: UserRepository;
  readonly hasher: PasswordHasher;
  readonly tokens: TokenService;
  readonly rateLimiter: RateLimiter;
  readonly attemptsPerMinute: number;
  /** Keyed hash of an email, so limiter keys hold no raw emails and cannot be dictionary-reversed. */
  readonly emailKey: (email: string) => string;
}

export interface RequestContext {
  readonly clientIp: string;
}

export interface AuthResult {
  readonly user: SessionUser;
  readonly token: string;
}

const WINDOW_SECONDS = 60;

export class AuthService {
  private dummyHash: Promise<string> | undefined;

  constructor(private readonly deps: AuthServiceDeps) {
    // Warm it up front so the very first unknown-email login is not measurably slower.
    this.getDummyHash().catch(() => undefined);
  }

  async register(input: RegisterRequest, context: RequestContext): Promise<AuthResult> {
    await this.throttle(context);
    const passwordHash = await this.deps.hasher.hash(input.password);
    try {
      const user = await this.deps.users.create({ email: input.email, passwordHash });
      return await this.startSession(user);
    } catch (error) {
      // Revealing that an email is taken is the usual register/enumeration trade-off.
      if (error instanceof DuplicateEmailError) {
        throw new ConflictError('An account with this email already exists.');
      }
      throw error;
    }
  }

  async login(input: LoginRequest, context: RequestContext): Promise<AuthResult> {
    await this.throttle(context, input.email);
    const user = await this.deps.users.findByEmail(input.email);
    // Unknown emails still pay for a full hash verification, so timing does not reveal them.
    const hashToCheck = user?.passwordHash ?? (await this.getDummyHash());
    const valid = await this.deps.hasher.verify(hashToCheck, input.password);
    if (user === null || !valid) throw new InvalidCredentialsError();
    return this.startSession(user);
  }

  authenticate(token: string): Promise<SessionUser | null> {
    return this.deps.tokens.verify(token);
  }

  /** Per-IP always; per-email on login only (a per-email cap on register would be trivially dodged). */
  private async throttle(context: RequestContext, email?: string): Promise<void> {
    const { rateLimiter, attemptsPerMinute } = this.deps;
    await enforceRateLimit(rateLimiter, {
      key: `auth:ip:${context.clientIp}`,
      limit: attemptsPerMinute,
      windowSeconds: WINDOW_SECONDS,
    });
    if (email !== undefined) {
      await enforceRateLimit(rateLimiter, {
        key: `auth:email:${this.deps.emailKey(email)}`,
        limit: Math.ceil(attemptsPerMinute / 2),
        windowSeconds: WINDOW_SECONDS,
      });
    }
  }

  private getDummyHash(): Promise<string> {
    if (!this.dummyHash) {
      const pending = this.deps.hasher.hash(randomUUID());
      this.dummyHash = pending;
      // A failed attempt must not be cached forever, or every unknown email would become a 500.
      pending.catch(() => {
        if (this.dummyHash === pending) this.dummyHash = undefined;
      });
    }
    return this.dummyHash;
  }

  private async startSession(record: UserRecord): Promise<AuthResult> {
    const user: SessionUser = { id: record.id, email: record.email };
    return { user, token: await this.deps.tokens.issue(user) };
  }
}
