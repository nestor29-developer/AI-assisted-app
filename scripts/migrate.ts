import { resolve } from 'node:path';

import { loadMigrationConfig } from '@/server/core/config/env';
import { createPool } from '@/server/core/db/client';
import { runMigrations } from '@/server/core/db/migrator';
import { provisionAppRole } from '@/server/core/db/roles';
import { createLogger } from '@/server/core/logger';

/** Applies ./drizzle, then sets up the app's login if asked. In AWS: a one-off task as the master user. */
async function main(): Promise<void> {
  const logger = createLogger({ level: 'info', version: 'migrate' });
  const { database, appRole } = loadMigrationConfig(process.env);
  const pool = createPool(database, { logger, statementTimeoutMs: 0 });
  try {
    await runMigrations(pool, resolve('drizzle'));
    logger.info('migrations applied');
    if (appRole) {
      await provisionAppRole(pool, appRole);
      logger.info({ role: appRole.username }, 'application role provisioned');
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
