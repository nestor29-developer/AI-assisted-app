import { describe, expect, it } from 'vitest';

import { CrossOriginRequestError } from '@/server/core/errors';

import { assertSameOrigin } from './origin';

const allowed = ['http://localhost:3000'];

function request(method: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/v1/x', { method, headers });
}

describe('assertSameOrigin', () => {
  it.each([
    ['POST from the app origin', 'POST', { origin: 'http://localhost:3000' }],
    ['POST with no browser headers (curl, tests)', 'POST', {}],
    ['POST from a same-origin fetch', 'POST', { 'sec-fetch-site': 'same-origin' }],
    ['GET from anywhere (safe method)', 'GET', { origin: 'https://evil.example' }],
  ])('allows %s', (_label, method, headers) => {
    expect(() => assertSameOrigin(request(method, headers), allowed)).not.toThrow();
  });

  it.each([
    ['POST from another origin', 'POST', { origin: 'https://evil.example' }],
    ['DELETE from the literal "null" origin', 'DELETE', { origin: 'null' }],
    ['POST flagged cross-site without Origin', 'POST', { 'sec-fetch-site': 'cross-site' }],
    ['PUT flagged same-site (sibling subdomain)', 'PUT', { 'sec-fetch-site': 'same-site' }],
  ])('rejects %s', (_label, method, headers) => {
    expect(() => assertSameOrigin(request(method, headers), allowed)).toThrow(
      CrossOriginRequestError,
    );
  });
});
