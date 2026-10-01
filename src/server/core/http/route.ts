import type { z } from 'zod';

import { AuthenticationError, normalizeError } from '@/server/core/errors';
import type { Logger } from '@/server/core/logger';
import type { SessionUser } from '@/server/core/session';

import { parseInput, readJsonBody } from './input';
import { assertSameOrigin } from './origin';
import { problemResponse } from './problem';

export type Authenticator = (request: Request) => Promise<SessionUser | null>;

export interface RouteDeps {
  readonly logger: Logger;
  readonly authenticate: Authenticator;
  readonly allowedOrigins: readonly string[];
  readonly maxJsonBytes: number;
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
}

type NextParams = Promise<Record<string, string | string[] | undefined>>;
export type RouteHandler = (request: Request, context: { params: NextParams }) => Promise<Response>;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function resolveRequestId(request: Request): string {
  const incoming = request.headers.get('x-request-id');
  return incoming !== null && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
}

function withRequestId(response: Response, requestId: string): Response {
  try {
    response.headers.set('x-request-id', requestId);
    return response;
  } catch {
    // Responses from fetch()/redirect() have immutable headers; rebuild instead.
    const headers = new Headers(response.headers);
    headers.set('x-request-id', requestId);
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

    return async (request, routeContext) => {
      const startedAt = performance.now();
      const deps = getDeps();
      const requestId = resolveRequestId(request);
      const { pathname, searchParams } = new URL(request.url);
      const log = deps.logger.child({ requestId });
      let user: SessionUser | null = null;
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
          ? await readJsonBody(request, spec.body, deps.maxJsonBytes)
          : (undefined as B);

        response = await handler({
          request,
          requestId,
          log: user ? log.child({ userId: user.id }) : log,
          params,
          query,
          body,
          user: user as UserFor<A>,
        });
      } catch (error) {
        const appError = normalizeError(error);
        if (appError.status >= 500)
          log.error({ err: appError.cause ?? appError, code: appError.code }, 'request failed');
        response = problemResponse(appError, { requestId, instance: pathname });
      }

      const status = response.status;
      const level =
        status >= 500 ? 'error' : pathname.startsWith('/api/v1/health') ? 'debug' : 'info';
      // For streamed responses this measures time to first byte, not total stream time.
      log[level](
        {
          method: request.method,
          path: pathname,
          status,
          durationMs: Math.round(performance.now() - startedAt),
          userId: user?.id,
        },
        'request completed',
      );
      return withRequestId(response, requestId);
    };
  };
}
