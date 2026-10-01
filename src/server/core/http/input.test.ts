import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '@/server/core/errors';

import { parseInput, readBodyCapped, readJsonBody } from './input';

const json = (
  body: string,
  headers: Record<string, string> = { 'content-type': 'application/json' },
) => new Request('http://localhost/x', { method: 'POST', body, headers });

describe('readBodyCapped', () => {
  it('returns the full body when under the cap', async () => {
    const bytes = await readBodyCapped(json('hello'), 10);
    expect(new TextDecoder().decode(bytes)).toBe('hello');
  });

  it('rejects early when Content-Length already exceeds the cap', async () => {
    const request = json('x', { 'content-type': 'application/json', 'content-length': '999999' });
    await expect(readBodyCapped(request, 100)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('enforces the cap while streaming when no Content-Length is declared', async () => {
    await expect(readBodyCapped(json('x'.repeat(500)), 100)).rejects.toBeInstanceOf(
      PayloadTooLargeError,
    );
  });
});

describe('readJsonBody', () => {
  const schema = z.object({ email: z.email() });

  it('parses and validates a JSON body', async () => {
    await expect(readJsonBody(json('{"email":"a@b.co"}'), schema, 1024)).resolves.toEqual({
      email: 'a@b.co',
    });
  });

  it('requires an application/json content type', async () => {
    const request = json('{"email":"a@b.co"}', { 'content-type': 'text/plain' });
    await expect(readJsonBody(request, schema, 1024)).rejects.toBeInstanceOf(
      UnsupportedMediaTypeError,
    );
  });

  it('reports malformed JSON as a validation error', async () => {
    await expect(readJsonBody(json('{nope'), schema, 1024)).rejects.toMatchObject({
      issues: [{ path: '', message: 'Body is not valid JSON.' }],
    });
  });

  it('reports schema violations with field paths', async () => {
    await expect(readJsonBody(json('{"email":"nope"}'), schema, 1024)).rejects.toMatchObject({
      issues: [{ path: 'email' }],
    });
  });
});

describe('parseInput', () => {
  it('prefixes issue paths with the input source', () => {
    try {
      parseInput(z.object({ limit: z.number() }), { limit: 'x' }, 'query');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues?.[0]?.path).toBe('query.limit');
    }
  });
});
