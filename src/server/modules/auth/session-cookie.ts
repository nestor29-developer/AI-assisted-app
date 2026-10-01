import { parseCookie, stringifySetCookie } from 'cookie';

/** Reads and writes the session cookie: HttpOnly, SameSite=Lax, and `__Host-` prefixed over HTTPS. */
export class SessionCookies {
  readonly name: string;

  constructor(
    private readonly secure: boolean,
    private readonly ttlSeconds: number,
  ) {
    this.name = secure ? '__Host-session' : 'session';
  }

  read(request: Request): string | null {
    const header = request.headers.get('cookie');
    return header ? (parseCookie(header)[this.name] ?? null) : null;
  }

  create(token: string): string {
    return this.serialize(token, this.ttlSeconds);
  }

  clear(): string {
    return this.serialize('', 0);
  }

  private serialize(value: string, maxAge: number): string {
    return stringifySetCookie({
      name: this.name,
      value,
      maxAge,
      path: '/',
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
    });
  }
}
