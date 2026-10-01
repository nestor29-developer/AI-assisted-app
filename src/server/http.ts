import 'server-only';

import { getContainer } from '@/server/container';
import { createRoute } from '@/server/core/http/route';

const MAX_JSON_BYTES = 1024 * 1024;

/** App-wide route(); deps resolve per request, so importing this never reads env at build time. */
export const route = createRoute(() => {
  const { config, logger, authenticate } = getContainer();
  return {
    logger,
    authenticate,
    allowedOrigins: config.appOrigins,
    maxJsonBytes: MAX_JSON_BYTES,
    trustedProxyHops: config.trustedProxyHops,
  };
});
