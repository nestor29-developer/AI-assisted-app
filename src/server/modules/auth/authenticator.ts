import type { Authenticator } from '@/server/core/http/route';

import type { AuthService } from './auth.service';
import type { SessionCookies } from './session-cookie';

/** Cookie in, user out. Any invalid or expired token simply means "not signed in". */
export function createRequestAuthenticator(
  cookies: SessionCookies,
  authService: AuthService,
): Authenticator {
  return async (request) => {
    const token = cookies.read(request);
    return token === null ? null : authService.authenticate(token);
  };
}
