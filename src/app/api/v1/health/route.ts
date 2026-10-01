import { getConfig } from '@/server/core/config/env';
import { route } from '@/server/http';

export const GET = route({ auth: 'public' }, () =>
  Response.json(
    { status: 'ok', version: getConfig().appVersion },
    { headers: { 'cache-control': 'no-store' } },
  ),
);
