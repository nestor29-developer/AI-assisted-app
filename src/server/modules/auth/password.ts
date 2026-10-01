import { hash, verify } from '@node-rs/argon2';

import { ConcurrencyLimiter } from '@/server/core/concurrency';
import { ServiceBusyError } from '@/server/core/errors';

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(storedHash: string, plain: string): Promise<boolean>;
}

export interface Argon2Params {
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

/** OWASP's minimum Argon2id profile: 19 MiB, 2 passes, 1 lane. */
export const OWASP_ARGON2_PARAMS: Argon2Params = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/** Argon2 shares libuv's 4-thread pool with DNS and file I/O, so leave half of it free. */
const defaultLimiter = () => new ConcurrencyLimiter(2, 64);

/** The library defaults to Argon2id and salts every hash, so only the cost needs choosing. */
export class Argon2PasswordHasher implements PasswordHasher {
  constructor(
    private readonly params: Argon2Params = OWASP_ARGON2_PARAMS,
    private readonly limiter: ConcurrencyLimiter = defaultLimiter(),
  ) {}

  hash(plain: string): Promise<string> {
    return this.limiter.run(() => hash(plain, { ...this.params }));
  }

  async verify(storedHash: string, plain: string): Promise<boolean> {
    try {
      return await this.limiter.run(() => verify(storedHash, plain));
    } catch (error) {
      if (error instanceof ServiceBusyError) throw error;
      return false;
    }
  }
}
