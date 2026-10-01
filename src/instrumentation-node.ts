import { ConfigError, getConfig } from '@/server/core/config/env';
import { getLogger } from '@/server/core/logger';

/** Bad config exits at once: a crash loop is easier for an orchestrator to see than a half-alive server. */
export function verifyBoot(): void {
  try {
    const config = getConfig();
    getLogger().info(
      {
        aiProvider: config.ai.provider,
        model: config.ai.llmModel,
        promptVersion: config.ai.promptVersion,
      },
      'configuration loaded',
    );
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}
