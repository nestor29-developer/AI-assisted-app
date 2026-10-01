import { defineConfig } from 'vitest/config';

import { alias } from './vitest.shared.mjs';

// Needs the docker compose database: `docker compose up -d db && npm run test:integration`.
export default defineConfig({
  resolve: { alias },
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
