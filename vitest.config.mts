import { defineConfig } from 'vitest/config';

import { alias } from './vitest.shared.mjs';

export default defineConfig({
  resolve: { alias },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
    restoreMocks: true,
  },
});
