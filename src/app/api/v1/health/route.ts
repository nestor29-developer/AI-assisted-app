import { route } from '@/server/http';

export const GET = route({ auth: 'public' }, () =>
  Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } }),
);
