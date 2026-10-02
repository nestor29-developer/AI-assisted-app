import type { z } from 'zod';

import { problemSchema, type ErrorCode, type ValidationIssue } from '@/shared/contracts/problem';

export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'UNEXPECTED_RESPONSE';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
    readonly issues: readonly ValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'DELETE';
  readonly json?: unknown;
  /** A multipart body; the browser sets the content type and boundary itself. */
  readonly form?: FormData;
  readonly signal?: AbortSignal;
}

export const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

export const networkError = () =>
  new ApiError(
    0,
    'NETWORK_ERROR',
    'Could not reach the server. Check your connection and try again.',
  );

function bodyOf({ json, form }: RequestOptions): { body?: BodyInit; headers: HeadersInit } {
  if (form !== undefined) return { body: form, headers: {} };
  if (json !== undefined) {
    return { body: JSON.stringify(json), headers: { 'content-type': 'application/json' } };
  }
  return { headers: {} };
}

async function request(path: string, options: RequestOptions): Promise<Response> {
  const { method = 'GET', signal } = options;
  const { body, headers } = bodyOf(options);
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { accept: 'application/json', ...headers },
      body,
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw networkError();
  }
  if (!response.ok) throw await toApiError(response);
  return response;
}

/** Turns a failed response (RFC 9457 problem+json, or anything a proxy sent) into an ApiError. */
export async function toApiError(response: Response): Promise<ApiError> {
  const problem = problemSchema.safeParse(await response.json().catch(() => null));
  if (!problem.success) {
    return new ApiError(
      response.status,
      'UNEXPECTED_RESPONSE',
      `Request failed (${response.status}).`,
    );
  }
  const { status, code, detail, title, retryAfterSeconds, errors } = problem.data;
  return new ApiError(status, code, detail ?? title, retryAfterSeconds, errors ?? []);
}

/** Calls the REST API and validates the success body against the shared contract. */
export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const response = await request(path, options);
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      'UNEXPECTED_RESPONSE',
      'The server sent an unexpected response.',
    );
  }
  return parsed.data;
}

/** For endpoints that answer 204 No Content. */
export async function apiSend(path: string, options: RequestOptions = {}): Promise<void> {
  await request(path, options);
}
