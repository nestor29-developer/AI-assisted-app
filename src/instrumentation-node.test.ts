import { afterEach, describe, expect, it, vi } from 'vitest';

const GOOD_ENV = {
  JWT_SECRET: 'a-test-signing-key-that-is-long-enough-to-pass',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  LOG_LEVEL: 'silent',
};

/** Boots with a fresh copy of the module, because the configuration is read once and then remembered. */
async function boot(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries({ ...GOOD_ENV, ...env })) vi.stubEnv(key, value);
  const { verifyBoot } = await import('./instrumentation-node');
  verifyBoot();
}

function watchExit() {
  const complaint = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('exit');
  });
  return { complaint, exit };
}

afterEach(() => vi.unstubAllEnvs());

describe('verifyBoot', () => {
  it.each(['v1', 'v2'])(
    'starts when the prompt version is one that exists (%s)',
    async (version) => {
      const { exit } = watchExit();

      await boot({ QA_PROMPT_VERSION: version });

      expect(exit).not.toHaveBeenCalled();
    },
  );

  it('exits at once, saying which versions exist, when the version is well formed but unknown', async () => {
    const { complaint, exit } = watchExit();

    await expect(boot({ QA_PROMPT_VERSION: 'v9' })).rejects.toThrow('exit');

    expect(exit).toHaveBeenCalledWith(1);
    expect(complaint).toHaveBeenCalledWith(
      expect.stringContaining('Unknown prompt document-qa@v9. Known versions: v1, v2'),
    );
  });

  it('still exits on a malformed version, as before', async () => {
    const { complaint, exit } = watchExit();

    await expect(boot({ QA_PROMPT_VERSION: 'latest' })).rejects.toThrow('exit');

    expect(exit).toHaveBeenCalledWith(1);
    expect(complaint).toHaveBeenCalledWith(expect.stringContaining('QA_PROMPT_VERSION'));
  });

  it('exits when a required setting is missing', async () => {
    const { complaint, exit } = watchExit();

    await expect(boot({ JWT_SECRET: '' })).rejects.toThrow('exit');

    expect(exit).toHaveBeenCalledWith(1);
    expect(complaint).toHaveBeenCalledWith(expect.stringContaining('JWT_SECRET'));
  });
});
