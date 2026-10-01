import { describe, expect, it } from 'vitest';

import { getClientIp } from './client-ip';

const headers = (xff?: string) => new Headers(xff === undefined ? {} : { 'x-forwarded-for': xff });

describe('getClientIp', () => {
  it('ignores X-Forwarded-For entirely when no proxy is trusted (it is client-controlled)', () => {
    expect(getClientIp(headers('1.2.3.4'), 0)).toBe('unknown');
  });

  it('takes the entry appended by the Nth trusted proxy from the right', () => {
    expect(getClientIp(headers('6.6.6.6, 198.51.100.7'), 1)).toBe('198.51.100.7');
    expect(getClientIp(headers('6.6.6.6, 198.51.100.7, 10.0.0.5'), 2)).toBe('198.51.100.7');
  });

  it('cannot be spoofed by prepending fake entries', () => {
    expect(getClientIp(headers('9.9.9.9, 8.8.8.8, 203.0.113.9'), 1)).toBe('203.0.113.9');
  });

  it('falls back to unknown for missing, short or malformed values', () => {
    expect(getClientIp(headers(), 1)).toBe('unknown');
    expect(getClientIp(headers('1.2.3.4'), 2)).toBe('unknown');
    expect(getClientIp(headers('not-an-ip'), 1)).toBe('unknown');
  });
});

describe('getClientIp for IPv6', () => {
  const ip = (address: string) => getClientIp(headers(address), 1);

  it('collapses every address in a /64 to one identity, however it is written', () => {
    const identities = [
      '2001:db8:abcd:12::1',
      '2001:DB8:ABCD:0012:ffff:ffff:ffff:ffff',
      '2001:db8:abcd:12:0:0:0:0',
      '2001:db8:abcd:12:1234:5678:9abc:def0',
    ].map(ip);

    expect(new Set(identities)).toEqual(new Set(['2001:db8:abcd:12::/64']));
  });

  it('keeps different /64 networks apart', () => {
    expect(ip('2001:db8:abcd:12::1')).not.toBe(ip('2001:db8:abcd:13::1'));
    expect(ip('2001:db8:abcd:12::1')).not.toBe(ip('2001:db9:abcd:12::1'));
  });

  it('handles compressed forms, zone ids and embedded IPv4', () => {
    expect(ip('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ip('::1')).toBe('0:0:0:0::/64');
    expect(ip('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(ip('64:ff9b::198.51.100.7')).toBe('64:ff9b:0:0::/64');
  });

  it('treats an IPv4-mapped address as the IPv4 client it really is', () => {
    expect(ip('::ffff:203.0.113.9')).toBe('203.0.113.9');
  });
});
