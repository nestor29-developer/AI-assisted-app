import { vi } from 'vitest';

export interface ApiCall {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly signal: AbortSignal | null | undefined;
  readonly headers: Headers;
}

type Handler = (call: ApiCall) => Response | Promise<Response>;

/** Routes are keyed "METHOD /path"; a request nobody planned for fails the test loudly. */
export function stubApi(routes: Record<string, Handler>) {
  const calls: ApiCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(href, 'http://localhost').pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    const call: ApiCall = {
      method,
      path,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body,
      signal: init?.signal,
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    const handler = routes[`${method} ${path}`];
    if (!handler) throw new Error(`Unhandled request: ${method} ${path}`);
    return handler(call);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    fetchMock,
    callsTo: (key: string) => calls.filter((call) => `${call.method} ${call.path}` === key),
  };
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });

export const problem = (
  status: number,
  code: string,
  extra: { detail?: string; retryAfterSeconds?: number } = {},
) =>
  new Response(
    JSON.stringify({
      type: `urn:problem:${code.toLowerCase()}`,
      title: code,
      status,
      code,
      ...extra,
    }),
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
