import { resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';

import { loadDatabaseConfig } from '@/server/core/config/env';
import { createPool } from '@/server/core/db/client';
import { runMigrations } from '@/server/core/db/migrator';
import * as schema from '@/server/core/db/schema';
import { createLogger } from '@/server/core/logger';

const LOCAL_DEFAULT = 'postgresql://app:app@localhost:5432/docqa';

export const testDatabaseUrl = (): string => process.env.DATABASE_URL ?? LOCAL_DEFAULT;

/** A pool on the compose database (or DATABASE_URL), with no statement timeout. */
export function createTestPool() {
  const config = loadDatabaseConfig({ DATABASE_URL: testDatabaseUrl() });
  return createPool(config, {
    logger: createLogger({ level: 'silent', version: 'test' }),
    statementTimeoutMs: 0,
  });
}

/** Connects to the test database and makes sure migrations are applied. */
export async function connectTestDatabase() {
  const pool = createTestPool();
  await runMigrations(pool, resolve('drizzle'));
  return { db: drizzle(pool, { schema }), pool, close: () => pool.end() };
}
