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
  readonly signal?: AbortSignal;
}

async function request(
  path: string,
  { method = 'GET', json, signal }: RequestOptions,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: json === undefined ? undefined : JSON.stringify(json),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Could not reach the server. Check your connection and try again.',
    );
  }
  if (!response.ok) throw await toApiError(response);
  return response;
}

async function toApiError(response: Response): Promise<ApiError> {
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
