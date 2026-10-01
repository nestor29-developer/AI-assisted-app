import { resolve } from 'node:path';

import { loadDatabaseConfig } from '@/server/core/config/env';
import { createPool } from '@/server/core/db/client';
import { runMigrations } from '@/server/core/db/migrator';
import { createLogger } from '@/server/core/logger';

/** Applies the SQL files in ./drizzle. In AWS this runs as a one-off task with the master role. */
async function main(): Promise<void> {
  const logger = createLogger({ level: 'info', version: 'migrate' });
  const pool = createPool(loadDatabaseConfig(process.env), { logger, statementTimeoutMs: 0 });
  try {
    await runMigrations(pool, resolve('drizzle'));
    logger.info('migrations applied');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
