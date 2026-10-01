import { eq } from 'drizzle-orm';

import type { Database } from '@/server/core/db/client';
import { hasPgErrorCode, PG_UNIQUE_VIOLATION } from '@/server/core/db/errors';
import { users } from '@/server/core/db/schema';

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly createdAt: Date;
}

export interface NewUser {
  readonly email: string;
  readonly passwordHash: string;
}

export class DuplicateEmailError extends Error {
  constructor() {
    super('A user with this email already exists');
    this.name = 'DuplicateEmailError';
  }
}

export interface UserRepository {
  create(input: NewUser): Promise<UserRecord>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
}

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewUser): Promise<UserRecord> {
    try {
      const [row] = await this.db.insert(users).values(input).returning();
      if (!row) throw new Error('Insert into users returned no row');
      return row;
    } catch (error) {
      if (hasPgErrorCode(error, PG_UNIQUE_VIOLATION)) throw new DuplicateEmailError();
      throw error;
    }
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ?? null;
  }
}
