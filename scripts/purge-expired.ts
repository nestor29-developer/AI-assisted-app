import { drizzle } from 'drizzle-orm/node-postgres';

import { loadMaintenanceConfig } from '@/server/core/config/env';
import { createPool } from '@/server/core/db/client';
import * as schema from '@/server/core/db/schema';
import { createLogger } from '@/server/core/logger';
import { DrizzleAiRequestRepository } from '@/server/modules/usage/ai-request.repository';
import { RetentionService } from '@/server/modules/usage/retention.service';
import { staleAfterSeconds } from '@/server/modules/usage/usage.service';

const BATCH_SIZE = 500;

/** Run daily by a scheduled task in AWS. Safe at any time, and safe if two runs overlap. */
async function main(): Promise<void> {
  const logger = createLogger({ level: process.env.LOG_LEVEL ?? 'info', version: 'purge' });
  const config = loadMaintenanceConfig(process.env);
  const pool = createPool(config.database, { logger, statementTimeoutMs: 120_000 });
  try {
    const db = drizzle(pool, { schema });
    const service = new RetentionService(db, new DrizzleAiRequestRepository(db), {
      aiRequestRetentionDays: config.aiRequestRetentionDays,
      staleAfterSeconds: staleAfterSeconds(config.llmTimeoutMs),
      batchSize: BATCH_SIZE,
    });
    logger.info(await service.run(), 'retention purge finished');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
