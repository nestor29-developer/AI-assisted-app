import { CrossOriginRequestError } from '@/server/core/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** CSRF defense in depth beside SameSite=Lax; non-browser clients (curl) send neither header. */
export function assertSameOrigin(request: Request, allowedOrigins: readonly string[]): void {
  if (SAFE_METHODS.has(request.method)) return;

  const origin = request.headers.get('origin');
  if (origin !== null) {
    if (!allowedOrigins.includes(origin)) throw new CrossOriginRequestError();
    return;
  }

  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin' && site !== 'none')
    throw new CrossOriginRequestError();
}
