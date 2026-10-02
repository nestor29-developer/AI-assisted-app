import { describe, expect, it } from 'vitest';

import {
  ConfigError,
  loadConfig,
  loadDatabaseConfig,
  loadMaintenanceConfig,
  loadMigrationConfig,
} from './env';

const valid = {
  JWT_SECRET: 'x'.repeat(32),
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
};

function failure(source: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(source);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('applies safe defaults to a minimal environment', () => {
    const config = loadConfig(valid);

    expect(config.ai.provider).toBe('mock');
    expect(config.ai.llmModel).toBe('gemini-3.8-flash');
    expect(config.ai.ragTopK).toBe(6);
    expect(config.ai.mockChunkDelayMs).toBe(15);
    expect(config.appOrigins).toEqual(['http://localhost:3000']);
    expect(config.auth.sessionTtlSeconds).toBe(8 * 3600);
    expect(config.auth.cookieSecure).toBe(false);
    expect(config.limits.maxUploadBytes).toBe(10 * 1024 * 1024);
    expect(config.policy.injectionPolicy).toBe('flag');
    expect(config.database).toMatchObject({ kind: 'url', poolMax: 5, ssl: false });
  });

  it('lets the mock model stream slowly enough to watch, within sane bounds', () => {
    expect(loadConfig({ ...valid, MOCK_LLM_CHUNK_DELAY_MS: '400' }).ai.mockChunkDelayMs).toBe(400);
    expect(failure({ ...valid, MOCK_LLM_CHUNK_DELAY_MS: '0' }).problems.join()).toContain(
      'MOCK_LLM_CHUNK_DELAY_MS',
    );
    expect(failure({ ...valid, MOCK_LLM_CHUNK_DELAY_MS: '60000' }).problems.join()).toContain(
      'MOCK_LLM_CHUNK_DELAY_MS',
    );
  });

  it('treats blank values like unset ones (as in a copied .env.example)', () => {
    expect(() => loadConfig({ ...valid, GEMINI_API_KEY: '', RAG_TOP_K: '' })).not.toThrow();
  });

  it('requires an API key only for the gemini provider', () => {
    expect(failure({ ...valid, LLM_PROVIDER: 'gemini' }).problems.join()).toContain(
      'GEMINI_API_KEY',
    );
    expect(
      loadConfig({ ...valid, LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k'.repeat(20) }).ai
        .geminiApiKey,
    ).toBeDefined();
  });

  it('accepts discrete PG* variables instead of DATABASE_URL', () => {
    const { database } = loadConfig({
      JWT_SECRET: valid.JWT_SECRET,
      PGHOST: 'db.internal',
      PGUSER: 'app_rw',
      PGPASSWORD: 'secret',
      PGDATABASE: 'docqa',
      DATABASE_SSL: 'true',
    });
    expect(database).toMatchObject({ kind: 'params', host: 'db.internal', port: 5432, ssl: true });
  });

  it('reports every problem, naming variables but never echoing their values', () => {
    const error = failure({ JWT_SECRET: 'too-short-secret-value', RAG_TOP_K: 'banana' });
    const message = error.message;

    expect(error.problems.length).toBeGreaterThanOrEqual(3);
    expect(message).toContain('JWT_SECRET');
    expect(message).toContain('RAG_TOP_K');
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('too-short-secret-value');
    expect(message).not.toContain('banana');
  });

  it('normalizes and validates origins; https-only origins mark cookies Secure', () => {
    const config = loadConfig({
      ...valid,
      APP_ORIGIN: 'https://app.example.com/path, https://admin.example.com/',
    });
    expect(config.appOrigins).toEqual(['https://app.example.com', 'https://admin.example.com']);
    expect(config.auth.cookieSecure).toBe(true);

    expect(failure({ ...valid, APP_ORIGIN: 'not a url' }).problems.join()).toContain('APP_ORIGIN');
    expect(failure({ ...valid, APP_ORIGIN: 'ftp://example.com' }).problems.join()).toContain(
      'APP_ORIGIN',
    );
  });

  it.each([
    ['RAG_TOP_K', '0'],
    ['RAG_TOP_K', '21'],
    ['MAX_UPLOAD_MB', 'abc'],
    ['TRUSTED_PROXY_HOPS', '9'],
    ['QA_PROMPT_VERSION', 'latest'],
    ['INJECTION_POLICY', 'maybe'],
  ])('rejects %s=%s', (name, value) => {
    expect(failure({ ...valid, [name]: value }).problems.join()).toContain(name);
  });

  it('refuses the development JWT placeholder in production', () => {
    const placeholder = { ...valid, JWT_SECRET: 'dev-only-change-me-dev-only-change-me-0000' };
    expect(() => loadConfig(placeholder)).not.toThrow();
    expect(failure({ ...placeholder, NODE_ENV: 'production' }).problems.join()).toContain(
      'JWT_SECRET',
    );
  });
});

describe('loadDatabaseConfig', () => {
  it('needs only database variables (a migration task has no JWT secret)', () => {
    expect(loadDatabaseConfig({ DATABASE_URL: valid.DATABASE_URL })).toMatchObject({ kind: 'url' });
  });

  it('fails clearly when no database is configured', () => {
    expect(() => loadDatabaseConfig({})).toThrow(/DATABASE_URL/);
  });
});

// Built at runtime (96 chars, 36 distinct) so no random-looking literal sits in the repo for scanners.
const STRONG_TEST_SECRET = Array.from(
  { length: 48 },
  (_, i) => String.fromCharCode(65 + (i % 26)) + (i % 10),
).join('');

describe('production rules', () => {
  const production = {
    ...valid,
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://app.example.com',
    TRUSTED_PROXY_HOPS: '1',
    JWT_SECRET: STRONG_TEST_SECRET,
  };

  it('accepts a proper HTTPS deployment behind one proxy', () => {
    const config = loadConfig(production);
    expect(config.auth.cookieSecure).toBe(true);
    expect(config.trustedProxyHops).toBe(1);
  });

  it('accepts the all-localhost demo used by docker compose, without a proxy', () => {
    const demo = {
      ...production,
      APP_ORIGIN: 'http://localhost:3100',
      TRUSTED_PROXY_HOPS: undefined,
    };
    expect(loadConfig(demo).auth.cookieSecure).toBe(false);
  });

  it.each([
    ['plain http on a public host', 'http://app.example.com'],
    [
      'https mixed with localhost (would issue a shadowable non-Secure cookie)',
      'https://app.example.com,http://localhost:3000',
    ],
  ])('rejects %s', (_label, origin) => {
    expect(failure({ ...production, APP_ORIGIN: origin }).problems.join()).toContain('APP_ORIGIN');
  });

  it('requires trusted proxy hops for a public deployment (otherwise one shared rate-limit bucket)', () => {
    expect(failure({ ...production, TRUSTED_PROXY_HOPS: '0' }).problems.join()).toContain(
      'TRUSTED_PROXY_HOPS',
    );
  });

  it.each([
    ['a repeated character', 'a'.repeat(64)],
    ['too short for 256 bits', STRONG_TEST_SECRET.slice(0, 32)],
    ['low variety', 'ab'.repeat(30)],
  ])('rejects a weak JWT secret: %s', (_label, secret) => {
    expect(failure({ ...production, JWT_SECRET: secret }).problems.join()).toContain('JWT_SECRET');
  });

  it('does not apply these rules outside production', () => {
    expect(() => loadConfig({ ...valid, APP_ORIGIN: 'http://app.example.com' })).not.toThrow();
  });

  it('never echoes credentials embedded in an origin', () => {
    const message = failure({ ...valid, APP_ORIGIN: 'ftp://admin:hunter2@example.com' }).message;
    expect(message).toContain('APP_ORIGIN');
    expect(message).not.toContain('hunter2');
  });
});

describe('loadMigrationConfig', () => {
  const database = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/db' };
  const role = { APP_DB_USER: 'app_rw', APP_DB_PASSWORD: 'a-long-enough-password' };

  it('needs only the database: a migration task holds no app secrets', () => {
    expect(loadMigrationConfig(database)).toMatchObject({
      database: { kind: 'url' },
      appRole: null,
    });
  });

  it('returns the app login when both variables are set', () => {
    expect(loadMigrationConfig({ ...database, ...role }).appRole).toEqual({
      username: 'app_rw',
      password: 'a-long-enough-password',
    });
  });

  it.each([
    ['only the user', { APP_DB_USER: 'app_rw' }],
    ['only the password', { APP_DB_PASSWORD: 'a-long-enough-password' }],
  ])('refuses %s, because half a login is a mistake', (_label, half) => {
    expect(() => loadMigrationConfig({ ...database, ...half })).toThrow(/must be set together/);
  });

  it.each([
    ['an upper-case name', { ...role, APP_DB_USER: 'App_RW' }, /APP_DB_USER/],
    ['a name that is not an identifier', { ...role, APP_DB_USER: 'app"; drop' }, /APP_DB_USER/],
    ['a short password', { ...role, APP_DB_PASSWORD: 'short' }, /APP_DB_PASSWORD/],
  ])('rejects %s', (_label, bad, message) => {
    expect(() => loadMigrationConfig({ ...database, ...bad })).toThrow(message);
  });

  it('still insists on a database', () => {
    expect(() => loadMigrationConfig(role)).toThrow(ConfigError);
  });
});

describe('loadMaintenanceConfig', () => {
  const database = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/db' };

  it('defaults to the documented retention and needs nothing but the database', () => {
    expect(loadMaintenanceConfig(database)).toMatchObject({
      aiRequestRetentionDays: 90,
      llmTimeoutMs: 60_000,
    });
  });

  it('reads the two settings it uses', () => {
    const config = loadMaintenanceConfig({
      ...database,
      AI_REQUEST_RETENTION_DAYS: '30',
      LLM_TIMEOUT_MS: '90000',
    });

    expect(config).toMatchObject({ aiRequestRetentionDays: 30, llmTimeoutMs: 90_000 });
  });

  it('refuses a retention of zero days, which would delete the audit trail at once', () => {
    expect(() => loadMaintenanceConfig({ ...database, AI_REQUEST_RETENTION_DAYS: '0' })).toThrow(
      /AI_REQUEST_RETENTION_DAYS/,
    );
  });
});
