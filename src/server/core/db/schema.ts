import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

// Relative import: drizzle-kit loads this file without the tsconfig path aliases.
import { EMBEDDING_DIMENSIONS } from '../constants';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [check('users_email_lowercase', sql`${t.email} = lower(${t.email})`)],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    sourceType: text('source_type').$type<'text' | 'file'>().notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    pageCount: integer('page_count'),
    content: text('content').notNull(),
    tokenEstimate: integer('token_estimate').notNull(),
    chunkCount: integer('chunk_count').notNull(),
    embeddingModel: text('embedding_model').notNull(),
    chunkerVersion: text('chunker_version').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
  },
  (t) => [
    check('documents_source_type_valid', sql`${t.sourceType} in ('text', 'file')`),
    index('documents_user_id_created_at_idx').on(t.userId, t.createdAt),
    index('documents_expires_at_idx').on(t.expiresAt),
  ],
);

export const documentChunks = pgTable(
  'document_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    // Denormalized so every vector search can filter by owner without a join.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    page: integer('page'),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
  },
  // No ANN index on purpose: every search is pre-filtered to one document, so exact KNN is fast.
  // The unique key also serves lookups by document_id, and stops re-chunking duplicating context.
  (t) => [unique('document_chunks_document_id_ordinal_unique').on(t.documentId, t.ordinal)],
);

export const aiRequests = pgTable(
  'ai_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    operation: text('operation').$type<'chat' | 'embed_document' | 'embed_query'>().notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptId: text('prompt_id'),
    promptVersion: text('prompt_version'),
    contextStrategy: text('context_strategy').$type<'full' | 'retrieval'>(),
    retrieval: jsonb('retrieval').$type<{ chunkId: string; score: number }[]>(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    thinkingTokens: integer('thinking_tokens'),
    reservedTokens: integer('reserved_tokens').notNull().default(0),
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 12, scale: 6, mode: 'number' }),
    latencyMs: integer('latency_ms'),
    ttftMs: integer('ttft_ms'),
    finishReason: text('finish_reason'),
    outcome: text('outcome')
      .$type<'in_progress' | 'success' | 'error' | 'cancelled' | 'declined'>()
      .notNull()
      .default('in_progress'),
    injectionFlag: boolean('injection_flag').notNull().default(false),
    appVersion: text('app_version').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'ai_requests_operation_valid',
      sql`${t.operation} in ('chat', 'embed_document', 'embed_query')`,
    ),
    check(
      'ai_requests_outcome_valid',
      sql`${t.outcome} in ('in_progress', 'success', 'error', 'cancelled', 'declined')`,
    ),
    check('ai_requests_context_strategy_valid', sql`${t.contextStrategy} in ('full', 'retrieval')`),
    // A negative count would quietly shrink the daily quota SUM.
    check(
      'ai_requests_tokens_non_negative',
      sql`${t.inputTokens} >= 0 and ${t.outputTokens} >= 0 and ${t.thinkingTokens} >= 0 and ${t.reservedTokens} >= 0`,
    ),
    index('ai_requests_user_id_created_at_idx').on(t.userId, t.createdAt),
    // Partial: purging a document runs `SET document_id = NULL` here, and must not scan the table.
    index('ai_requests_document_id_idx')
      .on(t.documentId)
      .where(sql`${t.documentId} is not null`),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<'user' | 'assistant'>().notNull(),
    content: text('content').notNull(),
    answer: jsonb('answer'),
    status: text('status')
      .$type<'completed' | 'failed' | 'cancelled'>()
      .notNull()
      .default('completed'),
    errorCode: text('error_code'),
    feedback: text('feedback').$type<'up' | 'down'>(),
    feedbackComment: text('feedback_comment'),
    aiRequestId: uuid('ai_request_id').references(() => aiRequests.id, { onDelete: 'set null' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('messages_role_valid', sql`${t.role} in ('user', 'assistant')`),
    check('messages_status_valid', sql`${t.status} in ('completed', 'failed', 'cancelled')`),
    check('messages_feedback_valid', sql`${t.feedback} in ('up', 'down')`),
    index('messages_document_id_created_at_idx').on(t.documentId, t.createdAt),
    // Purging old ai_requests runs `SET ai_request_id = NULL` here, and must not scan the table.
    index('messages_ai_request_id_idx')
      .on(t.aiRequestId)
      .where(sql`${t.aiRequestId} is not null`),
  ],
);

export const rateLimitWindows = pgTable(
  'rate_limit_windows',
  {
    key: text('key').notNull(),
    windowStart: timestamptz('window_start').notNull(),
    count: integer('count').notNull(),
  },
  // window_start leads, so deleting expired windows is a range scan and inserts hit the newest pages.
  (t) => [primaryKey({ columns: [t.windowStart, t.key] })],
);
