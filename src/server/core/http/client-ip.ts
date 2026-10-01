import { isIP } from 'node:net';

const UNKNOWN = 'unknown';

/** A subscriber usually owns a whole /64, so IPv6 clients are keyed by that prefix, not the address. */
function ipv6Network(address: string): string {
  const withoutZone = address.split('%')[0]!.toLowerCase();

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(withoutZone);
  if (mapped) return mapped[1]!;

  // Turn a trailing dotted quad (::1.2.3.4) into two hextets so every group has the same shape.
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(withoutZone);
  const normalized = dotted
    ? `${dotted[1]}${((Number(dotted[2]) << 8) | Number(dotted[3])).toString(16)}:${((Number(dotted[4]) << 8) | Number(dotted[5])).toString(16)}`
    : withoutZone;

  const [head = '', tail] = normalized.split('::');
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === undefined || tail === '' ? [] : tail.split(':');
  const zeros =
    tail === undefined ? [] : Array<string>(8 - headGroups.length - tailGroups.length).fill('0');
  const groups = [...headGroups, ...zeros, ...tailGroups];

  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/** Rate-limit identity (IPv4, or the IPv6 /64), read from the right of X-Forwarded-For: only our proxies' entries are trusted. */
export function getClientIp(headers: Headers, trustedProxyHops: number): string {
  if (trustedProxyHops <= 0) return UNKNOWN;
  const hops = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const candidate = hops[hops.length - trustedProxyHops];
  if (candidate === undefined) return UNKNOWN;

  switch (isIP(candidate)) {
    case 4:
      return candidate;
    case 6:
      return ipv6Network(candidate);
    default:
      return UNKNOWN;
  }
}
