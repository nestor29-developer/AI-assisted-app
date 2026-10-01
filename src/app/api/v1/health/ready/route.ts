import { getContainer } from '@/server/container';
import { toLoggableError } from '@/server/core/errors';
import { route } from '@/server/http';

export const GET = route({ auth: 'public' }, async ({ log }) => {
  try {
    await getContainer().database.ping();
    return Response.json({ status: 'ready' });
  } catch (err) {
    log.error({ err: toLoggableError(err) }, 'readiness check failed');
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
});
