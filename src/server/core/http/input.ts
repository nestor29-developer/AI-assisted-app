import type { z } from 'zod';

import {
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
  zodIssuesToValidationIssues,
} from '@/server/core/errors';

/** Reads the body with a hard cap, even for chunked requests that omit Content-Length. */
export async function readBodyCapped(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new PayloadTooLargeError(maxBytes);

  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function parseInput<T>(schema: z.ZodType<T>, value: unknown, prefix = ''): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  throw new ValidationError(
    zodIssuesToValidationIssues(result.error).map((issue) => ({
      path: [prefix, issue.path].filter(Boolean).join('.'),
      message: issue.message,
    })),
  );
}

export async function readJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes: number,
): Promise<T> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    throw new UnsupportedMediaTypeError('Content-Type must be application/json.');
  }

  const bytes = await readBodyCapped(request, maxBytes);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ValidationError([{ path: '', message: 'Body is not valid JSON.' }]);
  }
  return parseInput(schema, json);
}
