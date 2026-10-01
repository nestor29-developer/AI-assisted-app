import 'server-only';

import { cookies } from 'next/headers';

import { getContainer } from '@/server/container';
import type { SessionUser } from '@/server/core/session';

/** For server components only. A layout check is a UX nicety; every API route re-checks. */
export async function getSessionUser(): Promise<SessionUser | null> {
  // cookies() must come first: it marks the route dynamic, so `next build` never reads config.
  const cookieStore = await cookies();
  const { authService, sessionCookies } = getContainer();
  const token = cookieStore.get(sessionCookies.name)?.value;
  return token ? authService.authenticate(token) : null;
}
