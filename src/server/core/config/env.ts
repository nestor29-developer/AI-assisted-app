import 'server-only';

import { z } from 'zod';

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
  for (const raw of value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
      origins.push(url.origin);
    } catch {
      ctx.addIssue({ code: 'custom', message: `"${raw}" is not a valid http(s) origin` });
      return z.NEVER;
    }
  }
  if (origins.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'at least one origin is required' });
    return z.NEVER;
  }
  return origins;
});

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_VERSION: z.string().min(1).default('dev'),
  APP_ORIGIN: originList.default(() => ['http://localhost:3000']),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  SESSION_TTL_HOURS: int(8, 168),

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
  DB_POOL_MAX: int(10, 100),

  LLM_PROVIDER: z.enum(['gemini', 'mock']).default('mock'),
  LLM_MODEL: z.string().min(1).default('gemini-3.8-flash'),
  GEMINI_API_KEY: z.string().min(10).optional(),
  EMBEDDING_MODEL: z.string().min(1).default('gemini-embedding-2'),
  QA_PROMPT_VERSION: z
    .string()
    .regex(/^v\d+$/, 'must look like v1, v2, ...')
    .default('v1'),
  FULL_CONTEXT_MAX_TOKENS: int(3000),
  RAG_TOP_K: int(6, 20),
  LLM_TIMEOUT_MS: int(60_000),

  MAX_UPLOAD_MB: int(10, 50),
  MAX_PDF_PAGES: int(100, 1000),
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

/** Zod skips refinements once a field fails, so these run separately and all problems show at once. */
function crossFieldProblems(env: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  if (env.LLM_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
    problems.push('GEMINI_API_KEY: is required when LLM_PROVIDER=gemini');
  }
  if (env.NODE_ENV === 'production' && env.JWT_SECRET?.startsWith(PLACEHOLDER_JWT_PREFIX)) {
    problems.push('JWT_SECRET: must not be the development placeholder');
  }
  const hasParams = env.PGHOST && env.PGUSER && env.PGPASSWORD && env.PGDATABASE;
  if (!env.DATABASE_URL && !hasParams) {
    problems.push('DATABASE_URL: set it, or all of PGHOST, PGUSER, PGPASSWORD and PGDATABASE');
  }
  return problems;
}

function toDatabaseConfig(env: Env): DatabaseConfig {
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

/** Pure and side-effect free so tests can pass any source. Error messages never echo values. */
export function loadConfig(source: Readonly<Record<string, string | undefined>>): AppConfig {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') cleaned[key] = value;
  }
  const parsed = envSchema.safeParse(cleaned);
  const problems = [
    ...(parsed.success
      ? []
      : parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)),
    ...crossFieldProblems(cleaned),
  ];
  if (!parsed.success || problems.length > 0) throw new ConfigError(problems);
  const env = parsed.data;
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

let cached: AppConfig | undefined;

/** Lazy and memoized: never call at module scope, `next build` runs without runtime secrets. */
export function getConfig(): AppConfig {
  cached ??= loadConfig(process.env);
  return cached;
}
