import type { AppError } from '@/server/core/errors';
import { PROBLEM_CONTENT_TYPE, type ProblemDetails } from '@/shared/contracts/problem';

export interface ProblemContext {
  readonly requestId: string;
  readonly instance: string;
}

/** The RFC 9457 body; `code` is the stable field clients should branch on. */
export function toProblemDetails(error: AppError, context: ProblemContext): ProblemDetails {
  return {
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
}

export function problemDetailsResponse(problem: ProblemDetails): Response {
  const headers = new Headers({
    'content-type': PROBLEM_CONTENT_TYPE,
    'cache-control': 'no-store',
  });
  if (problem.retryAfterSeconds !== undefined) {
    headers.set('retry-after', String(problem.retryAfterSeconds));
  }
  return new Response(JSON.stringify(problem), { status: problem.status, headers });
}

export function problemResponse(error: AppError, context: ProblemContext): Response {
  return problemDetailsResponse(toProblemDetails(error, context));
}
