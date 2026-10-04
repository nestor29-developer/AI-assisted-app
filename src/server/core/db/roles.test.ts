import { createHash, createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { scramSha256Verifier } from './roles';

const hmac = (key: Buffer, text: string) => createHmac('sha256', key).update(text).digest();
const parse = (verifier: string) =>
  /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/.exec(verifier)?.slice(1) ?? [];

describe('scramSha256Verifier', () => {
  it('stores the keys that RFC 7677 derives for its worked example', () => {
    const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
    const [iterations, , stored, server] = parse(scramSha256Verifier('pencil', salt));
    const authMessage = [
      'n=user,r=rOprNGfwEbeRWgbNEkqO',
      'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096',
      'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0',
    ].join(',');

    expect(iterations).toBe('4096');
    // The server proves it knows the password by signing the exchange with the server key.
    expect(hmac(Buffer.from(server ?? '', 'base64'), authMessage).toString('base64')).toBe(
      '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=',
    );
    // The client's proof, undone with the stored key, hashes back to the stored key.
    const proof = Buffer.from('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'base64');
    const signature = hmac(Buffer.from(stored ?? '', 'base64'), authMessage);
    const clientKey = Buffer.from(proof.map((byte, index) => byte ^ (signature[index] ?? 0)));
    expect(createHash('sha256').update(clientKey).digest('base64')).toBe(stored);
  });

  it('has the shape Postgres reads, and shows nothing of the password', () => {
    const password = 'correct horse battery staple';

    const verifier = scramSha256Verifier(password);

    expect(verifier).toMatch(
      /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$/,
    );
    expect(verifier).not.toContain(password);
  });

  it('uses a new salt each time, so the same password never gives the same hash twice', () => {
    expect(scramSha256Verifier('the same password')).not.toBe(
      scramSha256Verifier('the same password'),
    );
  });

  it('accepts every printable ASCII character, spaces and quotes included', () => {
    const printable = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) =>
      String.fromCharCode(0x20 + i),
    ).join('');

    expect(() => scramSha256Verifier(printable)).not.toThrow();
  });

  it.each([
    ['accents', 'contraseña-segura-123'],
    ['an emoji', 'a-long-password-\u{1F512}'],
    ['a tab', 'tab\there-and-more-text'],
    ['a line break', 'line\nbreak-and-more-text'],
    ['nothing at all', ''],
  ])(
    'refuses a password with %s, which clients would not all hash the same way',
    (_label, password) => {
      expect(() => scramSha256Verifier(password)).toThrow(/printable ASCII/);
    },
  );
});
