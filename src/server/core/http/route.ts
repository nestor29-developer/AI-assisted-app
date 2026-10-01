import type { z } from 'zod';

import { AuthenticationError, normalizeError, toLoggableError } from '@/server/core/errors';
import type { Logger } from '@/server/core/logger';
import type { SessionUser } from '@/server/core/session';

import { getClientIp } from './client-ip';
import { parseInput, readJsonBody } from './input';
import { assertSameOrigin } from './origin';
import { problemResponse } from './problem';

export type Authenticator = (request: Request) => Promise<SessionUser | null>;

export interface RouteDeps {
  readonly logger: Logger;
  readonly authenticate: Authenticator;
  readonly allowedOrigins: readonly string[];
  readonly maxJsonBytes: number;
  readonly trustedProxyHops: number;
}

export type AuthMode = 'required' | 'optional' | 'public';

type UserFor<A extends AuthMode> = A extends 'required'
  ? SessionUser
  : A extends 'optional'
    ? SessionUser | null
    : null;

export interface HandlerContext<P, Q, B, U> {
  readonly request: Request;
  readonly requestId: string;
  readonly clientIp: string;
  readonly log: Logger;
  readonly params: P;
  readonly query: Q;
  readonly body: B;
  readonly user: U;
}

interface RouteSpec<P, Q, B, A extends AuthMode> {
  /** Defaults to 'required' so a forgotten option fails closed. */
  readonly auth?: A;
  readonly params?: z.ZodType<P>;
  readonly query?: z.ZodType<Q>;
  readonly body?: z.ZodType<B>;
  /** Overrides the app-wide JSON body cap; auth routes only need a few KiB. */
  readonly maxBodyBytes?: number;
}

type NextParams = Promise<Record<string, string | string[] | undefined>>;
export type RouteHandler = (request: Request, context: { params: NextParams }) => Promise<Response>;

const ROUTE_HANDLERS = new WeakSet<object>();

/** Lets a test prove that every exported HTTP method went through route() and not around it. */
export function isRouteHandler(value: unknown): boolean {
  return typeof value === 'function' && ROUTE_HANDLERS.has(value);
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const CLIENT_CLOSED_REQUEST = 499;

function resolveRequestId(request: Request): string {
  const incoming = request.headers.get('x-request-id');
  return incoming !== null && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
}

function finalize(response: Response, requestId: string): Response {
  const apply = (headers: Headers) => {
    headers.set('x-request-id', requestId);
    // Private API data must never sit in a shared cache; handlers can still opt out explicitly.
    if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  };
  try {
    apply(response.headers);
    return response;
  } catch {
    // Responses from fetch()/redirect() have immutable headers; rebuild instead.
    const headers = new Headers(response.headers);
    apply(headers);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

/** Cross-cutting HTTP concerns in one place: request id, CSRF, auth, validation, errors, logging. */
export function createRoute(getDeps: () => RouteDeps) {
  return function route<
    P = undefined,
    Q = undefined,
    B = undefined,
    A extends AuthMode = 'required',
  >(
    spec: RouteSpec<P, Q, B, A>,
    handler: (ctx: HandlerContext<P, Q, B, UserFor<A>>) => Promise<Response> | Response,
  ): RouteHandler {
    const authMode: AuthMode = spec.auth ?? 'required';

    const wrapped: RouteHandler = async (request, routeContext) => {
      const startedAt = performance.now();
      const deps = getDeps();
      const requestId = resolveRequestId(request);
      const { pathname, searchParams } = new URL(request.url);
      const log = deps.logger.child({ requestId });
      let user: SessionUser | null = null;
      let errorCode: string | undefined;
      let response: Response;

      try {
        assertSameOrigin(request, deps.allowedOrigins);

        if (authMode !== 'public') user = await deps.authenticate(request);
        if (authMode === 'required' && user === null) throw new AuthenticationError();

        const params = spec.params
          ? parseInput(spec.params, await routeContext?.params, 'params')
          : (undefined as P);
        const query = spec.query
          ? parseInput(spec.query, Object.fromEntries(searchParams), 'query')
          : (undefined as Q);
        const body = spec.body
          ? await readJsonBody(request, spec.body, spec.maxBodyBytes ?? deps.maxJsonBytes)
          : (undefined as B);

        response = await handler({
          request,
          requestId,
          clientIp: getClientIp(request.headers, deps.trustedProxyHops),
          log: user ? log.child({ userId: user.id }) : log,
          params,
          query,
          body,
          user: user as UserFor<A>,
        });
      } catch (error) {
        if (request.signal.aborted) {
          // The caller hung up mid-request (e.g. mid-upload); nobody is left to read an error page.
          errorCode = 'CLIENT_CLOSED';
          response = new Response(null, { status: CLIENT_CLOSED_REQUEST });
        } else {
          const appError = normalizeError(error);
          errorCode = appError.code;
          if (appError.status >= 500) {
            log.error({ err: toLoggableError(appError), code: appError.code }, 'request failed');
          }
          response = problemResponse(appError, { requestId, instance: pathname });
        }
      }

      const status = response.status;
      const quiet = pathname.startsWith('/api/v1/health') || errorCode === 'CLIENT_CLOSED';
      const level = status >= 500 ? 'error' : quiet ? 'debug' : 'info';
      // For streamed responses this measures time to first byte, not total stream time.
      log[level](
        {
          method: request.method,
          path: pathname,
          status,
          durationMs: Math.round(performance.now() - startedAt),
          userId: user?.id,
          code: errorCode,
        },
        'request completed',
      );
      return finalize(response, requestId);
    };

    ROUTE_HANDLERS.add(wrapped);
    return wrapped;
  };
}
