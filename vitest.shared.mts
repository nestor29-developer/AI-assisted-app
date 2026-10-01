import { fileURLToPath } from 'node:url';

export const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  // `server-only` throws outside a React Server environment; tests run in plain Node.
  'server-only': fileURLToPath(new URL('./src/test/stubs/server-only.ts', import.meta.url)),
};
