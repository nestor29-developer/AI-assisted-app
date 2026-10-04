import 'server-only';

import { z } from 'zod';

import { DEFAULT_FULL_CONTEXT_MAX_TOKENS, DEFAULT_RAG_TOP_K } from '@/server/core/constants';
import { DEFAULT_MAX_PDF_PAGES, DEFAULT_MAX_UPLOAD_MB } from '@/shared/contracts/documents';

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid configuration:\n${problems.map((p) => ` - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export type DatabaseConfig =
  | {
      readonly kind: 'url';
      readonly connectionString: string;
      readonly ssl: boolean;
      readonly poolMax: number;
    }
  | {
      readonly kind: 'params';
      readonly host: string;
      readonly port: number;
      readonly user: string;
      readonly password: string;
      readonly database: string;
      readonly ssl: boolean;
      readonly poolMax: number;
    };

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly logLevel: string;
  readonly appVersion: string;
  readonly appOrigins: readonly string[];
  readonly trustedProxyHops: number;
  readonly auth: {
    readonly jwtSecret: string;
    readonly sessionTtlSeconds: number;
    readonly cookieSecure: boolean;
  };
  readonly database: DatabaseConfig;
  readonly ai: {
    readonly provider: 'gemini' | 'mock';
    readonly llmModel: string;
    readonly geminiApiKey: string | undefined;
    readonly embeddingModel: string;
    readonly promptVersion: string;
    readonly fullContextMaxTokens: number;
    readonly ragTopK: number;
    readonly llmTimeoutMs: number;
    /** Pause between streamed chunks of the offline mock model; raise it to watch streaming and Stop. */
    readonly mockChunkDelayMs: number;
  };
  readonly limits: {
    readonly maxUploadBytes: number;
    readonly maxPdfPages: number;
    readonly maxDocumentChars: number;
    readonly dailyTokenBudget: number;
    readonly maxConcurrentStreams: number;
    readonly askPerMinute: number;
    readonly uploadsPerHour: number;
    readonly authPerMinute: number;
  };
  readonly policy: {
    readonly injectionPolicy: 'flag' | 'block';
    readonly documentRetentionDays: number;
    readonly aiRequestRetentionDays: number;
  };
}

/** The value shipped in .env.example; production refuses to boot with it. */
const PLACEHOLDER_JWT_PREFIX = 'dev-only';

const int = (def: number, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().positive().max(max).default(def);

const originList = z.string().transform((value, ctx) => {
  const origins: string[] = [];
  const entries = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  for (const [index, raw] of entries.entries()) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
      origins.push(url.origin);
    } catch {
      // The entry itself is not echoed: it may carry credentials (https://user:pass@host).
      ctx.addIssue({ code: 'custom', message: `entry ${index + 1} is not a valid http(s) origin` });
      return z.NEVER;
    }
  }
  if (origins.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'at least one origin is required' });
    return z.NEVER;
  }
  return origins;
});

const databaseEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must start with postgres:// or postgresql://')
    .optional(),
  PGHOST: z.string().min(1).optional(),
  PGPORT: int(5432, 65535),
  PGUSER: z.string().min(1).optional(),
  PGPASSWORD: z.string().min(1).optional(),
  PGDATABASE: z.string().min(1).optional(),
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  // tasks x pool max must stay well under the database's max_connections, also during rolling deploys.
  DB_POOL_MAX: int(5, 100),
});

const envSchema = databaseEnvSchema.extend({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_VERSION: z.string().min(1).default('dev'),
  APP_ORIGIN: originList.default(() => ['http://localhost:3000']),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  SESSION_TTL_HOURS: int(8, 168),

  LLM_PROVIDER: z.enum(['gemini', 'mock']).default('mock'),
  LLM_MODEL: z.string().min(1).default('gemini-3.8-flash'),
  GEMINI_API_KEY: z.string().min(10).optional(),
  EMBEDDING_MODEL: z.string().min(1).default('gemini-embedding-2'),
  QA_PROMPT_VERSION: z
    .string()
    .regex(/^v\d+$/, 'must look like v1, v2, ...')
    .default('v1'),
  FULL_CONTEXT_MAX_TOKENS: int(DEFAULT_FULL_CONTEXT_MAX_TOKENS),
  RAG_TOP_K: int(DEFAULT_RAG_TOP_K, 20),
  LLM_TIMEOUT_MS: int(60_000),
  MOCK_LLM_CHUNK_DELAY_MS: int(40, 5_000),

  MAX_UPLOAD_MB: int(DEFAULT_MAX_UPLOAD_MB, 50),
  MAX_PDF_PAGES: int(DEFAULT_MAX_PDF_PAGES, 1000),
  MAX_DOCUMENT_CHARS: int(400_000),
  DAILY_TOKEN_BUDGET: int(200_000),
  MAX_CONCURRENT_STREAMS: int(2, 10),
  ASK_RATE_LIMIT_PER_MIN: int(10),
  UPLOAD_RATE_LIMIT_PER_HOUR: int(20),
  AUTH_RATE_LIMIT_PER_MIN: int(10),
  INJECTION_POLICY: z.enum(['flag', 'block']).default('flag'),
  DATA_RETENTION_DAYS: int(30),
  AI_REQUEST_RETENTION_DAYS: int(90),
});

type Env = z.infer<typeof envSchema>;
type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
type RawEnv = Readonly<Record<string, string>>;

function databaseProblems(env: RawEnv): string[] {
  const hasParams = env.PGHOST && env.PGUSER && env.PGPASSWORD && env.PGDATABASE;
  if (env.DATABASE_URL || hasParams) return [];
  return ['DATABASE_URL: set it, or all of PGHOST, PGUSER, PGPASSWORD and PGDATABASE'];
}

/** Zod skips refinements once a field fails, so these run separately and all problems show at once. */
function crossFieldProblems(env: RawEnv): string[] {
  const problems = databaseProblems(env);
  if (env.LLM_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
    problems.push('GEMINI_API_KEY: is required when LLM_PROVIDER=gemini');
  }
  if (env.NODE_ENV === 'production' && env.JWT_SECRET?.startsWith(PLACEHOLDER_JWT_PREFIX)) {
    problems.push('JWT_SECRET: must not be the development placeholder');
  }
  return problems;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLoopbackHttp(origin: string): boolean {
  const url = new URL(origin);
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

/** 43+ characters is 256 bits of base64; the distinct-character floor rejects "aaaa..." style secrets. */
function isStrongSecret(secret: string): boolean {
  return secret.length >= 43 && new Set(secret).size >= 12;
}

/** Production is either HTTPS behind a proxy, or an all-localhost demo (docker compose on a laptop). */
function productionProblems(env: Env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  const localDemo = env.APP_ORIGIN.every(isLoopbackHttp);
  const allHttps = env.APP_ORIGIN.every((origin) => origin.startsWith('https://'));

  if (!localDemo && !allHttps) {
    problems.push(
      'APP_ORIGIN: use https origins only in production (http is accepted only when every origin is localhost)',
    );
  }
  if (!localDemo && env.TRUSTED_PROXY_HOPS < 1) {
    problems.push(
      'TRUSTED_PROXY_HOPS: set it to the number of proxies in front of the app (1 behind an ALB), or every client shares one rate-limit bucket',
    );
  }
  if (!isStrongSecret(env.JWT_SECRET)) {
    problems.push(
      'JWT_SECRET: use a random value of 43+ characters with varied characters (openssl rand -base64 48)',
    );
  }
  return problems;
}

function toDatabaseConfig(env: DatabaseEnv): DatabaseConfig {
  const common = { ssl: env.DATABASE_SSL === 'true', poolMax: env.DB_POOL_MAX };
  if (env.DATABASE_URL) return { kind: 'url', connectionString: env.DATABASE_URL, ...common };
  return {
    kind: 'params',
    host: env.PGHOST!,
    port: env.PGPORT,
    user: env.PGUSER!,
    password: env.PGPASSWORD!,
    database: env.PGDATABASE!,
    ...common,
  };
}

function clean(source: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') cleaned[key] = value;
  }
  return cleaned;
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`);
}

/** Only the database variables: a migration task should not need app secrets like JWT_SECRET. */
export function loadDatabaseConfig(
  source: Readonly<Record<string, string | undefined>>,
): DatabaseConfig {
  const cleaned = clean(source);
  const parsed = databaseEnvSchema.safeParse(cleaned);
  const problems = [
    ...(parsed.success ? [] : formatIssues(parsed.error)),
    ...databaseProblems(cleaned),
  ];
  if (!parsed.success || problems.length > 0) throw new ConfigError(problems);
  return toDatabaseConfig(parsed.data);
}

/** Lower case only, so Postgres' case folding can never make two spellings the same role. */
const APP_ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

const appRoleEnvSchema = z.object({
  APP_DB_USER: z
    .string()
    .regex(APP_ROLE_NAME, 'must be a lower-case Postgres role name')
    .optional(),
  APP_DB_PASSWORD: z
    .string()
    .min(16, 'must be at least 16 characters')
    .regex(/^[\x20-\x7e]+$/, 'must use printable ASCII characters only')
    .optional(),
});

export interface MigrationConfig {
  readonly database: DatabaseConfig;
  /** The least-privilege role the app runs as; null where the app connects as the migration user. */
  readonly appRole: { readonly username: string; readonly password: string } | null;
}

/** For the migration task: the database, plus the app's own database login if one is to be set up. */
export function loadMigrationConfig(
  source: Readonly<Record<string, string | undefined>>,
): MigrationConfig {
  const database = loadDatabaseConfig(source);
  const parsed = appRoleEnvSchema.safeParse(clean(source));
  if (!parsed.success) throw new ConfigError(formatIssues(parsed.error));

  const { APP_DB_USER: username, APP_DB_PASSWORD: password } = parsed.data;
  if ((username === undefined) !== (password === undefined)) {
    throw new ConfigError(['APP_DB_USER and APP_DB_PASSWORD must be set together']);
  }
  return { database, appRole: username && password ? { username, password } : null };
}

const maintenanceEnvSchema = z.object({
  AI_REQUEST_RETENTION_DAYS: int(90),
  LLM_TIMEOUT_MS: int(60_000),
});

export interface MaintenanceConfig {
  readonly database: DatabaseConfig;
  readonly aiRequestRetentionDays: number;
  readonly llmTimeoutMs: number;
}

/** For the scheduled purge task: the database and two retention settings, nothing else. */
export function loadMaintenanceConfig(
  source: Readonly<Record<string, string | undefined>>,
): MaintenanceConfig {
  const database = loadDatabaseConfig(source);
  const parsed = maintenanceEnvSchema.safeParse(clean(source));
  if (!parsed.success) throw new ConfigError(formatIssues(parsed.error));
  return {
    database,
    aiRequestRetentionDays: parsed.data.AI_REQUEST_RETENTION_DAYS,
    llmTimeoutMs: parsed.data.LLM_TIMEOUT_MS,
  };
}

function toAppConfig(env: Env): AppConfig {
  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    appVersion: env.APP_VERSION,
    appOrigins: env.APP_ORIGIN,
    trustedProxyHops: env.TRUSTED_PROXY_HOPS,
    auth: {
      jwtSecret: env.JWT_SECRET,
      sessionTtlSeconds: env.SESSION_TTL_HOURS * 3600,
      cookieSecure: env.APP_ORIGIN.every((origin) => origin.startsWith('https://')),
    },
    database: toDatabaseConfig(env),
    ai: {
      provider: env.LLM_PROVIDER,
      llmModel: env.LLM_MODEL,
      geminiApiKey: env.GEMINI_API_KEY,
      embeddingModel: env.EMBEDDING_MODEL,
      promptVersion: env.QA_PROMPT_VERSION,
      fullContextMaxTokens: env.FULL_CONTEXT_MAX_TOKENS,
      ragTopK: env.RAG_TOP_K,
      llmTimeoutMs: env.LLM_TIMEOUT_MS,
      mockChunkDelayMs: env.MOCK_LLM_CHUNK_DELAY_MS,
    },
    limits: {
      maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
      maxPdfPages: env.MAX_PDF_PAGES,
      maxDocumentChars: env.MAX_DOCUMENT_CHARS,
      dailyTokenBudget: env.DAILY_TOKEN_BUDGET,
      maxConcurrentStreams: env.MAX_CONCURRENT_STREAMS,
      askPerMinute: env.ASK_RATE_LIMIT_PER_MIN,
      uploadsPerHour: env.UPLOAD_RATE_LIMIT_PER_HOUR,
      authPerMinute: env.AUTH_RATE_LIMIT_PER_MIN,
    },
    policy: {
      injectionPolicy: env.INJECTION_POLICY,
      documentRetentionDays: env.DATA_RETENTION_DAYS,
      aiRequestRetentionDays: env.AI_REQUEST_RETENTION_DAYS,
    },
  };
}

/** Pure and side-effect free so tests can pass any source. Error messages never echo values. */
export function loadConfig(source: Readonly<Record<string, string | undefined>>): AppConfig {
  const cleaned = clean(source);
  const parsed = envSchema.safeParse(cleaned);
  const problems = [
    ...(parsed.success ? [] : formatIssues(parsed.error)),
    ...crossFieldProblems(cleaned),
    ...(parsed.success ? productionProblems(parsed.data) : []),
  ];
  if (!parsed.success || problems.length > 0) throw new ConfigError(problems);
  return toAppConfig(parsed.data);
}

let cached: AppConfig | undefined;

/** Lazy and memoized: never call at module scope, `next build` runs without runtime secrets. */
export function getConfig(): AppConfig {
  cached ??= loadConfig(process.env);
  return cached;
}
