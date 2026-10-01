import { getContainer } from '@/server/container';
import { route } from '@/server/http';
import { loginRequestSchema, type AuthResponse } from '@/shared/contracts/auth';

/** Credentials are tiny; a small cap keeps junk bodies away from the parser. */
const AUTH_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = route(
  { auth: 'public', maxBodyBytes: AUTH_BODY_LIMIT_BYTES, body: loginRequestSchema },
  async ({ body, clientIp }) => {
    const { authService, sessionCookies } = getContainer();
    const { user, token } = await authService.login(body, { clientIp });
    return Response.json({ user } satisfies AuthResponse, {
      headers: { 'set-cookie': sessionCookies.create(token) },
    });
  },
);
