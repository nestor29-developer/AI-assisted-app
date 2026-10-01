import { z } from 'zod';

import type { ErrorCode, ValidationIssue } from '@/shared/contracts/problem';

export interface AppErrorOptions {
  /** Safe, user-facing explanation. Never put secrets, stack traces or raw upstream messages here. */
  readonly detail?: string;
  readonly cause?: unknown;
  readonly retryAfterSeconds?: number;
  readonly issues?: readonly ValidationIssue[];
}

/** Errors the API returns on purpose; anything else is a bug and becomes a generic 500. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly issues: readonly ValidationIssue[] | undefined;

  constructor(code: ErrorCode, status: number, title: string, options: AppErrorOptions = {}) {
    super(title, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.detail = options.detail;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.issues = options.issues;
  }
}

export class ValidationError extends AppError {
  constructor(issues: readonly ValidationIssue[], detail = 'The request is invalid.') {
    super('VALIDATION_ERROR', 400, 'Validation failed', { issues, detail });
  }
}

export class AuthenticationError extends AppError {
  constructor(detail = 'Authentication is required.') {
    super('UNAUTHENTICATED', 401, 'Unauthenticated', { detail });
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    // One generic message for "unknown email" and "wrong password" (no account enumeration).
    super('INVALID_CREDENTIALS', 401, 'Invalid credentials', {
      detail: 'Email or password is incorrect.',
    });
  }
}

export class ForbiddenError extends AppError {
  constructor(detail = 'You are not allowed to perform this action.') {
    super('FORBIDDEN', 403, 'Forbidden', { detail });
  }
}

export class CrossOriginRequestError extends AppError {
  constructor() {
    super('CROSS_ORIGIN_REQUEST', 403, 'Cross-origin request rejected', {
      detail: 'Requests that change state must come from the application origin.',
    });
  }
}

/** Also used for resources owned by someone else, so existence is never leaked. */
export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super('NOT_FOUND', 404, 'Not found', { detail: `${resource} not found.` });
  }
}

export class ConflictError extends AppError {
  constructor(detail: string) {
    super('CONFLICT', 409, 'Conflict', { detail });
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(maxBytes: number) {
    super('PAYLOAD_TOO_LARGE', 413, 'Payload too large', {
      detail: `The request body exceeds the ${formatBytes(maxBytes)} limit.`,
    });
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(detail: string) {
    super('UNSUPPORTED_MEDIA_TYPE', 415, 'Unsupported media type', { detail });
  }
}

/** Input was understood but cannot be processed (e.g. a scanned PDF with no text layer). */
export class UnprocessableError extends AppError {
  constructor(
    code: Extract<ErrorCode, 'PDF_NO_TEXT_LAYER' | 'DOCUMENT_REJECTED' | 'INPUT_REJECTED'>,
    detail: string,
  ) {
    super(code, 422, 'Unprocessable content', { detail });
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super('RATE_LIMITED', 429, 'Too many requests', {
      detail: `Rate limit exceeded. Try again in ${retryAfterSeconds}s.`,
      retryAfterSeconds,
    });
  }
}

export class QuotaExceededError extends AppError {
  constructor(retryAfterSeconds: number) {
    super('QUOTA_EXCEEDED', 429, 'Daily AI quota exceeded', {
      detail: 'You have used your daily AI allowance. It resets on a rolling 24-hour window.',
      retryAfterSeconds,
    });
  }
}

export class TooManyConcurrentRequestsError extends AppError {
  constructor(max: number) {
    super('TOO_MANY_CONCURRENT_REQUESTS', 429, 'Too many concurrent requests', {
      detail: `At most ${max} answers can be generated at the same time. Wait for one to finish.`,
      retryAfterSeconds: 5,
    });
  }
}

/** The AI provider (or another upstream dependency) failed or is unavailable. */
export class AiUnavailableError extends AppError {
  constructor(cause?: unknown, retryAfterSeconds?: number) {
    super('AI_UNAVAILABLE', 503, 'AI service unavailable', {
      detail: 'The AI service is temporarily unavailable. Please try again.',
      cause,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
  }
}

export class InternalError extends AppError {
  constructor(cause?: unknown) {
    super('INTERNAL', 500, 'Internal server error', {
      detail: 'Something went wrong on our side.',
      cause,
    });
  }
}

/** Unknown errors become a generic 500 (logged, never returned); a stray ZodError is a bug, not a 400. */
export function normalizeError(error: unknown): AppError {
  return error instanceof AppError ? error : new InternalError(error);
}

export interface LoggableError {
  readonly type: string;
  readonly message: string;
  readonly code?: string;
  readonly stack?: string;
}

/** Log the root cause only: Drizzle's wrapper message embeds bound parameters such as emails and hashes. */
export function toLoggableError(error: unknown): LoggableError {
  let root: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    const cause =
      typeof root === 'object' && root !== null && 'cause' in root ? root.cause : undefined;
    if (cause === undefined || cause === null) break;
    root = cause;
  }
  if (!(root instanceof Error)) return { type: typeof root, message: String(root).slice(0, 500) };

  const code = 'code' in root && typeof root.code === 'string' ? root.code : undefined;
  return {
    type: root.name,
    message: root.message.slice(0, 1_000),
    ...(code === undefined ? {} : { code }),
    ...(root.stack === undefined ? {} : { stack: root.stack }),
  };
}

export function zodIssuesToValidationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${+(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${+(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} bytes`;
}

/** Load shedding: the server is saturated, so say so quickly instead of queueing without limit. */
export class ServiceBusyError extends AppError {
  constructor(retryAfterSeconds = 2) {
    super('SERVICE_BUSY', 503, 'Service busy', {
      detail: 'The server is handling a lot of requests right now. Please try again shortly.',
      retryAfterSeconds,
    });
  }
}
