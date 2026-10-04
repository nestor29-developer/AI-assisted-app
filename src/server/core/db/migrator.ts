import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool, PoolClient } from 'pg';

// Any constant works; it only has to be the same in every process that migrates this database.
const MIGRATION_LOCK_KEY = 727_001;
/** Longer than any migration should take; past it, something holds the lock that should not. */
const DEFAULT_LOCK_WAIT_MS = 15 * 60_000;
const LOCK_NOT_AVAILABLE = '55P03';

export interface MigrationOptions {
  /** More work to do under the same lock, once the migrations are applied. */
  readonly afterwards?: () => Promise<void>;
  /** How long to wait for another migration to finish before giving up. */
  readonly lockWaitMs?: number;
}

/** The pool's own lock_timeout is a few seconds, so the wait for the lock gets a longer one of its own. */
async function acquireLock(client: PoolClient, waitMs: number): Promise<void> {
  await client.query('begin');
  try {
    await client.query("select set_config('lock_timeout', $1, true)", [String(waitMs)]);
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    if ((error as { code?: string }).code === LOCK_NOT_AVAILABLE) {
      throw new Error(`Gave up after waiting ${waitMs / 1000} s for another migration to finish`, {
        cause: error,
      });
    }
    throw error;
  }
}

/** Runs under an advisory lock, so deploys that start together take turns instead of racing. */
export async function runMigrations(
  pool: Pool,
  migrationsFolder: string,
  { afterwards, lockWaitMs = DEFAULT_LOCK_WAIT_MS }: MigrationOptions = {},
): Promise<void> {
  const client = await pool.connect();
  try {
    await acquireLock(client, lockWaitMs);
    // Same connection as the lock, so the lock is held for exactly as long as this runs.
    await migrate(drizzle(client), { migrationsFolder });
    await afterwards?.();
  } finally {
    await client
      .query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
      .catch(() => undefined);
    client.release();
  }
}
