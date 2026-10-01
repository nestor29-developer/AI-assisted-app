import { z } from 'zod';

/** Machine-readable codes: clients branch on `code`, never on `detail` text. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
  'CROSS_ORIGIN_REQUEST',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'PDF_NO_TEXT_LAYER',
  'DOCUMENT_REJECTED',
  'INPUT_REJECTED',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'TOO_MANY_CONCURRENT_REQUESTS',
  'AI_UNAVAILABLE',
  'SERVICE_BUSY',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const validationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export type ValidationIssue = z.infer<typeof validationIssueSchema>;

/** RFC 9457 "problem details" body, plus `code`/`requestId`/`retryAfterSeconds` extension members. */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(ERROR_CODES),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
  errors: z.array(validationIssueSchema).optional(),
});

export type ProblemDetails = z.infer<typeof problemSchema>;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
