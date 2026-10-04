import { drizzle } from 'drizzle-orm/node-postgres';

import { loadMaintenanceConfig } from '@/server/core/config/env';
import { createPool } from '@/server/core/db/client';
import * as schema from '@/server/core/db/schema';
import { createLogger } from '@/server/core/logger';
import { DrizzleAiRequestRepository } from '@/server/modules/usage/ai-request.repository';
import { RetentionService } from '@/server/modules/usage/retention.service';
import { staleAfterSeconds } from '@/server/modules/usage/usage.service';

/** Keeps each delete well under a second; a document takes its chunks and messages with it. */
const BATCH_SIZE = 500;
/** Rest between batches, so a large backlog leaves the app's own queries room. */
const PAUSE_BETWEEN_BATCHES_MS = 100;

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
      pauseBetweenBatchesMs: PAUSE_BETWEEN_BATCHES_MS,
    });
    const result = await service.run();
    logger.info(result, 'retention purge finished');
    if (result.truncated.length > 0) {
      logger.warn(
        { steps: result.truncated },
        'purge stopped at the batch limit; the next run carries on',
      );
    }
    if (result.failed.length > 0) {
      logger.error({ failed: result.failed }, 'purge steps failed');
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
