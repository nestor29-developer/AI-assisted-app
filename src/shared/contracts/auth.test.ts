import { describe, expect, it } from 'vitest';

import { emailSchema, loginRequestSchema, registerRequestSchema } from './auth';

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('emailSchema', () => {
  it('asks for an address when the field is empty or only spaces', () => {
    expect(messages(emailSchema.safeParse(''))).toEqual(['Enter your email address.']);
    expect(messages(emailSchema.safeParse('   '))).toEqual(['Enter your email address.']);
  });

  it('says what is wrong when something is typed that is not an address', () => {
    expect(messages(emailSchema.safeParse('not-an-address'))).toEqual([
      'Enter a valid email address.',
    ]);
  });

  it('refuses an address longer than the database column can hold', () => {
    expect(messages(emailSchema.safeParse(`${'a'.repeat(250)}@x.com`))).toEqual([
      'Use at most 254 characters.',
    ]);
  });

  it('trims and lower-cases what it accepts, so one person is one account', () => {
    expect(emailSchema.parse('  Ana@Example.TEST ')).toBe('ana@example.test');
  });
});

describe('the sign-in and registration requests', () => {
  it('asks for the password at sign-in without judging its length', () => {
    const result = loginRequestSchema.safeParse({ email: 'a@example.test', password: '' });

    expect(messages(result)).toEqual(['Enter your password.']);
    expect(loginRequestSchema.safeParse({ email: 'a@example.test', password: 'x' }).success).toBe(
      true,
    );
  });

  it('asks for at least ten characters when registering', () => {
    const result = registerRequestSchema.safeParse({ email: 'a@example.test', password: 'short' });

    expect(messages(result)).toEqual(['Use at least 10 characters.']);
  });
});
