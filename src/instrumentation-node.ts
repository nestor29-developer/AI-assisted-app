import { DOCUMENT_QA_PROMPT_ID } from '@/server/ai/prompts/document-qa/shared';
import { createDefaultPromptRegistry, UnknownPromptError } from '@/server/ai/prompts/registry';
import { ConfigError, getConfig } from '@/server/core/config/env';
import { getLogger } from '@/server/core/logger';

/** Bad config exits at once: a crash loop is easier for an orchestrator to see than a half-alive server. */
export function verifyBoot(): void {
  try {
    const config = getConfig();
    // A well-formed version that names no prompt would otherwise fail every request, the health check too.
    createDefaultPromptRegistry().get(DOCUMENT_QA_PROMPT_ID, config.ai.promptVersion);
    getLogger().info(
      {
        aiProvider: config.ai.provider,
        model: config.ai.llmModel,
        promptVersion: config.ai.promptVersion,
      },
      'configuration loaded',
    );
  } catch (error) {
    if (!(error instanceof ConfigError) && !(error instanceof UnknownPromptError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}
