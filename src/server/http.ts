import 'server-only';

import { getConfig } from '@/server/core/config/env';
import { createRoute } from '@/server/core/http/route';
import { getLogger } from '@/server/core/logger';

const MAX_JSON_BYTES = 1024 * 1024;

/** App-wide route(); deps resolve per request, so importing this never reads env at build time. */
export const route = createRoute(() => ({
  logger: getLogger(),
  // Swapped for the real session authenticator in the auth phase; until then protected routes fail closed.
  authenticate: async () => null,
  allowedOrigins: getConfig().appOrigins,
  maxJsonBytes: MAX_JSON_BYTES,
}));
