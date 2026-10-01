import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './env';

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
    expect(config.appOrigins).toEqual(['http://localhost:3000']);
    expect(config.auth.sessionTtlSeconds).toBe(8 * 3600);
    expect(config.auth.cookieSecure).toBe(false);
    expect(config.limits.maxUploadBytes).toBe(10 * 1024 * 1024);
    expect(config.policy.injectionPolicy).toBe('flag');
    expect(config.database).toMatchObject({ kind: 'url', poolMax: 10, ssl: false });
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
