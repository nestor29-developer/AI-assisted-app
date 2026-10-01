'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { apiSend } from '@/lib/api-client';

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await apiSend('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      // Even if the call fails, the guarded layout sends an anonymous visitor to /login.
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <Button variant="secondary" loading={pending} onClick={signOut}>
      Sign out
    </Button>
  );
}
