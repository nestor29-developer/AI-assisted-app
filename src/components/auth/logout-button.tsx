'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiSend } from '@/lib/api-client';
import { describeError } from '@/lib/api-errors';
import { announceSignedOut } from '@/lib/auth-channel';

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  async function signOut() {
    setPending(true);
    setFailure(null);
    try {
      await apiSend('/api/v1/auth/logout', { method: 'POST' });
    } catch (error) {
      // The cookie was not cleared, so a login page here would be a lie about who is signed in.
      setFailure(`You are still signed in. ${describeError(error)}`);
      setPending(false);
      return;
    }
    announceSignedOut();
    router.replace('/login');
    router.refresh();
  }

  function dismiss() {
    setFailure(null);
    buttonRef.current?.focus();
  }

  return (
    <div className="relative">
      <Button ref={buttonRef} variant="secondary" loading={pending} onClick={signOut}>
        Sign out
      </Button>
      {failure ? (
        <div className="absolute top-full right-0 z-10 mt-2 w-72 max-w-[calc(100vw-2rem)]">
          <Alert tone="error">
            {failure}{' '}
            <button type="button" onClick={dismiss} className="font-medium underline">
              Dismiss
            </button>
          </Alert>
        </div>
      ) : null}
    </div>
  );
}
