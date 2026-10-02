import 'server-only';

import { DOCUMENT_QA_PROMPT_ID } from '@/server/ai/prompts/document-qa/shared';
import { createDefaultPromptRegistry } from '@/server/ai/prompts/registry';
import { createAiProviders, type AiProviders } from '@/server/ai/providers/factory';
import { getConfig, type AppConfig } from '@/server/core/config/env';
import { createDatabase, type DatabaseHandle } from '@/server/core/db/client';
import type { Authenticator } from '@/server/core/http/route';
import { getLogger, type Logger } from '@/server/core/logger';
import { AuthService } from '@/server/modules/auth/auth.service';
import { createRequestAuthenticator } from '@/server/modules/auth/authenticator';
import { createEmailKeyer } from '@/server/modules/auth/email-key';
import { JwtTokenService } from '@/server/modules/auth/jwt';
import { Argon2PasswordHasher } from '@/server/modules/auth/password';
import { SessionCookies } from '@/server/modules/auth/session-cookie';
import { DrizzleUserRepository } from '@/server/modules/auth/user.repository';
import { ChatService } from '@/server/modules/chat/chat.service';
import { ContextSelector } from '@/server/modules/chat/context-selector';
import { DrizzleMessageRepository } from '@/server/modules/chat/message.repository';
import { DrizzleChunkRepository } from '@/server/modules/documents/chunk.repository';
import { DocumentService } from '@/server/modules/documents/document.service';
import { DrizzleDocumentRepository } from '@/server/modules/documents/document.repository';
import { DrizzleAiRequestRepository } from '@/server/modules/usage/ai-request.repository';
import { PostgresRateLimiter, type RateLimiter } from '@/server/modules/usage/rate-limiter';
import { UsageService } from '@/server/modules/usage/usage.service';

export interface Container {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly database: DatabaseHandle;
  readonly rateLimiter: RateLimiter;
  readonly sessionCookies: SessionCookies;
  readonly authService: AuthService;
  readonly authenticate: Authenticator;
  readonly documentService: DocumentService;
  readonly chatService: ChatService;
}

export interface ContainerDeps {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly database: DatabaseHandle;
  /** Swapped in by tests and the eval harness; production resolves them from config. */
  readonly providers?: AiProviders;
}

const DAY_SECONDS = 86_400;
const STALE_RESERVATION_SLACK_SECONDS = 60;

/** The composition root: every concrete adapter is chosen and wired here, and only here. */
export function createContainer({ config, logger, database, providers }: ContainerDeps): Container {
  const { db } = database;
  const { llm, embeddings } = providers ?? createAiProviders(config.ai);

  const rateLimiter = new PostgresRateLimiter(db);
  const aiRequests = new DrizzleAiRequestRepository(db);
  const documents = new DrizzleDocumentRepository(db);
  const chunks = new DrizzleChunkRepository(db);

  const sessionCookies = new SessionCookies(
    config.auth.cookieSecure,
    config.auth.sessionTtlSeconds,
  );
  const authService = new AuthService({
    users: new DrizzleUserRepository(db),
    hasher: new Argon2PasswordHasher(),
    tokens: new JwtTokenService(config.auth.jwtSecret, config.auth.sessionTtlSeconds),
    rateLimiter,
    attemptsPerMinute: config.limits.authPerMinute,
    emailKey: createEmailKeyer(config.auth.jwtSecret),
  });

  const documentService = new DocumentService({
    documents,
    embeddings,
    aiRequests,
    rateLimiter,
    logger,
    config: {
      maxPdfPages: config.limits.maxPdfPages,
      maxDocumentChars: config.limits.maxDocumentChars,
      uploadsPerHour: config.limits.uploadsPerHour,
      documentRetentionDays: config.policy.documentRetentionDays,
      appVersion: config.appVersion,
    },
  });

  // Fails at startup, not on the first question, if QA_PROMPT_VERSION names a prompt that does not exist.
  const prompts = createDefaultPromptRegistry();
  prompts.get(DOCUMENT_QA_PROMPT_ID, config.ai.promptVersion);

  const chatService = new ChatService({
    documents,
    messages: new DrizzleMessageRepository(db),
    selector: new ContextSelector(chunks, embeddings, {
      fullContextMaxTokens: config.ai.fullContextMaxTokens,
      topK: config.ai.ragTopK,
    }),
    llm,
    prompts,
    usage: new UsageService(aiRequests, {
      maxConcurrent: config.limits.maxConcurrentStreams,
      dailyBudgetTokens: config.limits.dailyTokenBudget,
      windowSeconds: DAY_SECONDS,
      staleAfterSeconds: Math.ceil(config.ai.llmTimeoutMs / 1000) + STALE_RESERVATION_SLACK_SECONDS,
    }),
    aiRequests,
    rateLimiter,
    logger,
    config: {
      promptVersion: config.ai.promptVersion,
      askPerMinute: config.limits.askPerMinute,
      injectionPolicy: config.policy.injectionPolicy,
      llmTimeoutMs: config.ai.llmTimeoutMs,
      appVersion: config.appVersion,
      ragTopK: config.ai.ragTopK,
      fullContextMaxTokens: config.ai.fullContextMaxTokens,
    },
  });

  return {
    config,
    logger,
    database,
    rateLimiter,
    sessionCookies,
    authService,
    authenticate: createRequestAuthenticator(sessionCookies, authService),
    documentService,
    chatService,
  };
}

// Dev HMR re-evaluates modules; keeping the pool on globalThis stops it leaking connections.
const globalStore = globalThis as typeof globalThis & { __docqaDatabase?: DatabaseHandle };

let cached: Container | undefined;

/** Lazy and memoized: nothing connects or reads env until the first request. */
export function getContainer(): Container {
  if (!cached) {
    const config = getConfig();
    const logger = getLogger();
    globalStore.__docqaDatabase ??= createDatabase(config.database, logger);
    cached = createContainer({ config, logger, database: globalStore.__docqaDatabase });
  }
  return cached;
}
