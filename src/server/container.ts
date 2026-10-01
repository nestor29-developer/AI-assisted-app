import 'server-only';

import { getConfig, type AppConfig } from '@/server/core/config/env';
import { createDatabase, type DatabaseHandle } from '@/server/core/db/client';
import type { Authenticator } from '@/server/core/http/route';
import { getLogger, type Logger } from '@/server/core/logger';
import { AuthService } from '@/server/modules/auth/auth.service';
import { createRequestAuthenticator } from '@/server/modules/auth/authenticator';
import { createEmailKeyer } from '@/server/modules/auth/email-key';
import { JwtTokenService } from '@/server/modules/auth/jwt';
import { Argon2PasswordHasher } from '@/server/modules/auth/password';
import { SessionCookies } from '@/server/modules/auth/session-cookie';
import { DrizzleUserRepository } from '@/server/modules/auth/user.repository';
import { PostgresRateLimiter, type RateLimiter } from '@/server/modules/usage/rate-limiter';

export interface Container {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly database: DatabaseHandle;
  readonly rateLimiter: RateLimiter;
  readonly sessionCookies: SessionCookies;
  readonly authService: AuthService;
  readonly authenticate: Authenticator;
}

export interface ContainerDeps {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly database: DatabaseHandle;
}

/** The composition root: every concrete adapter is chosen and wired here, and only here. */
export function createContainer({ config, logger, database }: ContainerDeps): Container {
  const rateLimiter = new PostgresRateLimiter(database.db);
  const sessionCookies = new SessionCookies(
    config.auth.cookieSecure,
    config.auth.sessionTtlSeconds,
  );
  const authService = new AuthService({
    users: new DrizzleUserRepository(database.db),
    hasher: new Argon2PasswordHasher(),
    tokens: new JwtTokenService(config.auth.jwtSecret, config.auth.sessionTtlSeconds),
    rateLimiter,
    attemptsPerMinute: config.limits.authPerMinute,
    emailKey: createEmailKeyer(config.auth.jwtSecret),
  });

  return {
    config,
    logger,
    database,
    rateLimiter,
    sessionCookies,
    authService,
    authenticate: createRequestAuthenticator(sessionCookies, authService),
  };
}

// Dev HMR re-evaluates modules; keeping the pool on globalThis stops it leaking connections.
const globalStore = globalThis as typeof globalThis & { __docqaDatabase?: DatabaseHandle };

let cached: Container | undefined;

/** Lazy and memoized: nothing connects or reads env until the first request. */
export function getContainer(): Container {
  if (!cached) {
    const config = getConfig();
    const logger = getLogger();
    globalStore.__docqaDatabase ??= createDatabase(config.database, logger);
    cached = createContainer({ config, logger, database: globalStore.__docqaDatabase });
  }
  return cached;
}
