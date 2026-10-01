import type { AppError } from '@/server/core/errors';
import { PROBLEM_CONTENT_TYPE, type ProblemDetails } from '@/shared/contracts/problem';

export interface ProblemContext {
  readonly requestId: string;
  readonly instance: string;
}

/** Builds the RFC 9457 response; `code` is the stable field clients should branch on. */
export function problemResponse(error: AppError, context: ProblemContext): Response {
  const body: ProblemDetails = {
    type: `urn:problem:${error.code.toLowerCase().replaceAll('_', '-')}`,
    title: error.message,
    status: error.status,
    code: error.code,
    instance: context.instance,
    requestId: context.requestId,
    ...(error.detail === undefined ? {} : { detail: error.detail }),
    ...(error.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: error.retryAfterSeconds }),
    ...(error.issues === undefined ? {} : { errors: [...error.issues] }),
  };

  const headers = new Headers({
    'content-type': PROBLEM_CONTENT_TYPE,
    'cache-control': 'no-store',
  });
  if (error.retryAfterSeconds !== undefined) {
    headers.set('retry-after', String(error.retryAfterSeconds));
  }
  return new Response(JSON.stringify(body), { status: error.status, headers });
}
