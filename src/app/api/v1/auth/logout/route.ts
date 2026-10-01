import { getContainer } from '@/server/container';
import { route } from '@/server/http';

/** Public on purpose: signing out with an expired session must still clear the cookie. */
export const POST = route({ auth: 'public' }, () => {
  const { sessionCookies } = getContainer();
  return new Response(null, { status: 204, headers: { 'set-cookie': sessionCookies.clear() } });
});
