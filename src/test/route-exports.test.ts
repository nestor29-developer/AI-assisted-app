import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isRouteHandler } from '@/server/core/http/route';

const API_DIR = resolve('src/app/api');
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const routeFiles = readdirSync(API_DIR, { recursive: true, encoding: 'utf8' }).filter((file) =>
  file.endsWith('route.ts'),
);

describe('API route modules', () => {
  it('are discovered (guards against this test passing on an empty list)', () => {
    expect(routeFiles.length).toBeGreaterThanOrEqual(6);
  });

  it.each(routeFiles)(
    '%s exports only route()-wrapped handlers, so auth, CSRF and error mapping cannot be bypassed',
    async (file) => {
      const routeModule: Record<string, unknown> = await import(
        /* @vite-ignore */ join(API_DIR, file)
      );
      const exported = Object.keys(routeModule).filter((name) => HTTP_METHODS.includes(name));

      expect(exported.length).toBeGreaterThan(0);
      for (const method of exported) expect(isRouteHandler(routeModule[method])).toBe(true);
    },
  );
});
