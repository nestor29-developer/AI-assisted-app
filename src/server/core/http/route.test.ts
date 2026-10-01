import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { NotFoundError } from '@/server/core/errors';
import type { SessionUser } from '@/server/core/session';
import { createCapturingLogger } from '@/test/helpers/logger';

import { createRoute, type Authenticator } from './route';

const alice: SessionUser = { id: 'user-1', email: 'alice@example.com' };

function setup(authenticate: Authenticator = async () => null) {
  const { logger, records } = createCapturingLogger();
  const route = createRoute(() => ({
    logger,
    authenticate,
    allowedOrigins: ['http://localhost:3000'],
    maxJsonBytes: 1024,
  }));
  return { route, records };
}

const noParams = { params: Promise.resolve({}) };
const get = (path = '/api/v1/x', headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000${path}`, { headers });
const post = (
  body: string,
  headers: Record<string, string> = { 'content-type': 'application/json' },
) => new Request('http://localhost:3000/api/v1/x', { method: 'POST', body, headers });

describe('route(): request id', () => {
  it('generates one when absent and echoes it on the response', async () => {
    const { route } = setup();
    const handler = route({ auth: 'public' }, ({ requestId }) => Response.json({ requestId }));

    const response = await handler(get(), noParams);

    const id = response.headers.get('x-request-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await response.json()).toEqual({ requestId: id });
  });

  it('keeps a well-formed incoming id and replaces a malformed one', async () => {
    const { route } = setup();
    const handler = route({ auth: 'public' }, () => new Response('ok'));

    const kept = await handler(get('/api/v1/x', { 'x-request-id': 'trace-abc12345' }), noParams);
    const replaced = await handler(
      get('/api/v1/x', { 'x-request-id': 'not valid!! <b>' }),
      noParams,
    );

    expect(kept.headers.get('x-request-id')).toBe('trace-abc12345');
    expect(replaced.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('stamps responses whose headers are immutable (redirects)', async () => {
    const { route } = setup();
    const handler = route({ auth: 'public' }, () =>
      Response.redirect('http://localhost:3000/next', 302),
    );

    const response = await handler(get(), noParams);

    expect(response.status).toBe(302);
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });
});

describe('route(): authentication', () => {
  it('fails closed by default: no session means 401 and the handler never runs', async () => {
    const { route } = setup();
    const handle = vi.fn(() => new Response('secret'));

    const response = await route({}, handle)(get(), noParams);

    expect(response.status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('hands the authenticated user to the handler', async () => {
    const { route } = setup(async () => alice);
    const handler = route({}, ({ user }) => Response.json({ id: user.id }));

    expect(await (await handler(get(), noParams)).json()).toEqual({ id: 'user-1' });
  });

  it('lets optional routes run anonymously', async () => {
    const { route } = setup();
    const handler = route({ auth: 'optional' }, ({ user }) =>
      Response.json({ anonymous: user === null }),
    );

    expect(await (await handler(get(), noParams)).json()).toEqual({ anonymous: true });
  });

  it('never calls the authenticator on public routes', async () => {
    const authenticate = vi.fn(async () => alice);
    const { route } = setup(authenticate);

    await route({ auth: 'public' }, () => new Response('ok'))(get(), noParams);

    expect(authenticate).not.toHaveBeenCalled();
  });
});

describe('route(): input validation', () => {
  it('validates path params and prefixes error paths', async () => {
    const { route } = setup(async () => alice);
    const handler = route({ params: z.object({ id: z.uuid() }) }, ({ params }) =>
      Response.json(params),
    );

    const bad = await handler(get(), { params: Promise.resolve({ id: 'nope' }) });
    const id = '3f8d9f0e-8d3e-4a38-9d63-0e5a0f9a7c11';
    const good = await handler(get(), { params: Promise.resolve({ id }) });

    expect(bad.status).toBe(400);
    expect((await bad.json()).errors[0].path).toBe('params.id');
    expect(await good.json()).toEqual({ id });
  });

  it('coerces and validates the query string', async () => {
    const { route } = setup(async () => alice);
    const handler = route(
      { query: z.object({ limit: z.coerce.number().int().max(50) }) },
      ({ query }) => Response.json(query),
    );

    expect(await (await handler(get('/api/v1/x?limit=10'), noParams)).json()).toEqual({
      limit: 10,
    });
    const bad = await handler(get('/api/v1/x?limit=500'), noParams);
    expect(bad.status).toBe(400);
    expect((await bad.json()).errors[0].path).toBe('query.limit');
  });

  it('parses JSON bodies and maps malformed, oversized and mistyped ones to 400/413/415', async () => {
    const { route } = setup(async () => alice);
    const handler = route({ body: z.object({ title: z.string().min(1) }) }, ({ body }) =>
      Response.json(body),
    );

    expect(await (await handler(post('{"title":"ok"}'), noParams)).json()).toEqual({ title: 'ok' });
    expect((await handler(post('{broken'), noParams)).status).toBe(400);
    expect((await handler(post('{"title":""}'), noParams)).status).toBe(400);
    expect((await handler(post('x'.repeat(2000)), noParams)).status).toBe(413);
    expect((await handler(post('{}', { 'content-type': 'text/plain' }), noParams)).status).toBe(
      415,
    );
  });

  it('does not read the body of unauthenticated callers', async () => {
    const { route } = setup();
    const handler = route({ body: z.object({}) }, () => new Response('ok'));

    const response = await handler(post('x'.repeat(5000)), noParams);

    expect(response.status).toBe(401);
  });
});

describe('route(): CSRF origin check', () => {
  it('blocks cross-origin mutations before authentication runs', async () => {
    const authenticate = vi.fn(async () => alice);
    const { route } = setup(authenticate);
    const handler = route({}, () => new Response('ok'));

    const response = await handler(
      post('{}', { 'content-type': 'application/json', origin: 'https://evil.example' }),
      noParams,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'CROSS_ORIGIN_REQUEST' });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('allows the app origin', async () => {
    const { route } = setup(async () => alice);
    const handler = route({}, () => new Response('ok'));

    const response = await handler(
      post('{}', { 'content-type': 'application/json', origin: 'http://localhost:3000' }),
      noParams,
    );

    expect(response.status).toBe(200);
  });
});

describe('route(): error handling and logging', () => {
  it('maps thrown AppErrors to their problem response', async () => {
    const { route } = setup(async () => alice);
    const handler = route({}, () => {
      throw new NotFoundError('Document');
    });

    const response = await handler(get(), noParams);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'NOT_FOUND', instance: '/api/v1/x' });
  });

  it('hides unexpected errors from the client but logs them with the request id', async () => {
    const { route, records } = setup(async () => alice);
    const handler = route({}, async () => {
      throw new Error('boom: connection string postgres://u:p@h/db');
    });

    const response = await handler(get(), noParams);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain('boom');
    expect(text).not.toContain('postgres://');
    const failed = records().find((r) => r.msg === 'request failed');
    expect(failed).toMatchObject({
      code: 'INTERNAL',
      requestId: response.headers.get('x-request-id'),
    });
  });

  it('writes one completion line per request with status, duration and user id', async () => {
    const { route, records } = setup(async () => alice);

    await route({}, () => new Response('ok'))(get('/api/v1/things'), noParams);

    const completed = records().filter((r) => r.msg === 'request completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      method: 'GET',
      path: '/api/v1/things',
      status: 200,
      userId: 'user-1',
    });
    expect(typeof completed[0]?.durationMs).toBe('number');
  });
});
