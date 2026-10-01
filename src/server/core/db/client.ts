import 'server-only';

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { DatabaseConfig } from '@/server/core/config/env';
import { SERVICE_NAME } from '@/server/core/constants';
import { toLoggableError } from '@/server/core/errors';
import type { Logger } from '@/server/core/logger';

import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly db: Database;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface PoolOptions {
  readonly logger: Logger;
  /** 0 skips the client-side setting, so any server or role default still applies (migrations). */
  readonly statementTimeoutMs?: number;
}

export function createPool(
  config: DatabaseConfig,
  { logger, statementTimeoutMs = 30_000 }: PoolOptions,
): Pool {
  const pool = new Pool({
    ...(config.kind === 'url'
      ? { connectionString: config.connectionString }
      : {
          host: config.host,
          port: config.port,
          user: config.user,
          password: config.password,
          database: config.database,
        }),
    max: config.poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Recycle connections so a failover or a long-lived socket never lingers forever.
    maxLifetimeSeconds: 1_800,
    keepAlive: true,
    statement_timeout: statementTimeoutMs,
    // Client-side backstop for a hung socket, where the server-side timeout cannot fire.
    ...(statementTimeoutMs > 0 ? { query_timeout: statementTimeoutMs + 5_000 } : {}),
    // A transaction must never idle while we wait on a model call; fail it rather than pin locks.
    idle_in_transaction_session_timeout: 15_000,
    lock_timeout: 10_000,
    application_name: SERVICE_NAME,
    ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
  });
  // Without a listener, an error on an idle client would crash the whole process.
  pool.on('error', (err) =>
    logger.error({ err: toLoggableError(err) }, 'idle postgres client error'),
  );
  return pool;
}

export function createDatabase(config: DatabaseConfig, logger: Logger): DatabaseHandle {
  const pool = createPool(config, { logger });
  return {
    db: drizzle(pool, { schema }),
    ping: async () => void (await pool.query('select 1')),
    close: () => pool.end(),
  };
}
