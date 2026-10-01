import { describe, expect, it } from 'vitest';

import { SessionCookies } from './session-cookie';

const withCookie = (cookie: string) => new Request('http://localhost/x', { headers: { cookie } });

describe('SessionCookies', () => {
  it('sets a hardened cookie for plain HTTP development', () => {
    const header = new SessionCookies(false, 3600).create('tok');

    expect(header).toContain('session=tok');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=3600');
    expect(header).not.toContain('Secure');
  });

  it('uses the __Host- prefix and Secure over HTTPS', () => {
    const cookies = new SessionCookies(true, 3600);
    const header = cookies.create('tok');

    expect(cookies.name).toBe('__Host-session');
    expect(header).toContain('__Host-session=tok');
    expect(header).toContain('Secure');
    expect(header).not.toContain('Domain');
  });

  it('clears the cookie by expiring it immediately', () => {
    const header = new SessionCookies(false, 3600).clear();
    expect(header).toContain('session=;');
    expect(header).toContain('Max-Age=0');
  });

  it('reads its own cookie among others, and returns null when absent', () => {
    const cookies = new SessionCookies(false, 3600);

    expect(cookies.read(withCookie('theme=dark; session=abc.def.ghi; other=1'))).toBe(
      'abc.def.ghi',
    );
    expect(cookies.read(withCookie('theme=dark'))).toBeNull();
    expect(cookies.read(new Request('http://localhost/x'))).toBeNull();
  });
});
