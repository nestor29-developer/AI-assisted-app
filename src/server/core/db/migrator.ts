import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';

// Any constant works; it only has to be the same in every process that migrates this database.
const MIGRATION_LOCK_KEY = 727_001;

/** Serialized by an advisory lock, so two deploys starting together cannot race on the same files. */
export async function runMigrations(pool: Pool, migrationsFolder: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    // Same connection as the lock, so the lock is held for exactly as long as migrations run.
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client
      .query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
      .catch(() => undefined);
    client.release();
  }
}
