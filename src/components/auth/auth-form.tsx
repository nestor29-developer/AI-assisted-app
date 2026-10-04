'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { useFocusFirstInvalid } from '@/components/ui/use-focus-first-invalid';
import { apiFetch, ApiError } from '@/lib/api-client';
import { describeError } from '@/lib/api-errors';
import {
  authResponseSchema,
  loginRequestSchema,
  registerRequestSchema,
} from '@/shared/contracts/auth';

type Mode = 'login' | 'register';
type FieldErrors = Partial<Record<'email' | 'password', string>>;

const COPY = {
  login: {
    title: 'Sign in',
    submit: 'Sign in',
    endpoint: '/api/v1/auth/login',
    schema: loginRequestSchema,
    alt: { text: 'New here?', label: 'Create an account', href: '/register' },
    autoComplete: 'current-password',
  },
  register: {
    title: 'Create your account',
    submit: 'Create account',
    endpoint: '/api/v1/auth/register',
    schema: registerRequestSchema,
    alt: { text: 'Already registered?', label: 'Sign in', href: '/login' },
    autoComplete: 'new-password',
  },
} as const;

function toFieldErrors(issues: readonly { path: string; message: string }[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const { path, message } of issues) {
    if ((path === 'email' || path === 'password') && !errors[path]) errors[path] = message;
  }
  return errors;
}

export function AuthForm({ mode }: { readonly mode: Mode }) {
  const router = useRouter();
  const copy = COPY[mode];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useFocusFirstInvalid(fieldErrors);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFormError(null);

    const parsed = copy.schema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(
        toFieldErrors(
          parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        ),
      );
      return;
    }
    setFieldErrors({});

    setPending(true);
    try {
      await apiFetch(copy.endpoint, authResponseSchema, { method: 'POST', json: parsed.data });
      router.replace('/documents');
      router.refresh();
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === 'VALIDATION_ERROR' &&
        error.issues.length > 0
      ) {
        setFieldErrors(toFieldErrors(error.issues));
      } else {
        setFormError(describeError(error));
      }
      setPending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">{copy.title}</h1>
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <TextField
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fieldErrors.email}
        required
      />
      <TextField
        label="Password"
        type="password"
        name="password"
        autoComplete={copy.autoComplete}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={mode === 'register' ? 'At least 10 characters.' : undefined}
        error={fieldErrors.password}
        required
      />
      <Button type="submit" loading={pending} className="w-full">
        {copy.submit}
      </Button>
      <p className="text-center text-sm text-slate-600">
        {copy.alt.text}{' '}
        <Link href={copy.alt.href} className="font-medium text-indigo-600 hover:underline">
          {copy.alt.label}
        </Link>
      </p>
    </form>
  );
}
