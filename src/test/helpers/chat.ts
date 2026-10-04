import { screen, waitFor } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { expect } from 'vitest';

import { STOP_ARMS_AFTER_MS } from '@/components/chat/composer';
import type { DocumentSummary } from '@/shared/contracts/documents';
import type { MessageDto } from '@/shared/contracts/messages';

import { json } from './api';

export type User = ReturnType<typeof userEvent.setup>;

/** The two reads every chat screen makes: the document, and its stored thread. */
export function chatRoutes(document: DocumentSummary, messages: MessageDto[] = []) {
  const path = `/api/v1/documents/${document.id}`;
  return {
    [`GET ${path}`]: () => json({ document }),
    [`GET ${path}/messages`]: () => json({ messages }),
  };
}

/** The composer, once the thread has loaded and it is enabled. */
export async function composer() {
  const box = await screen.findByRole('textbox', { name: 'Your question' });
  await waitFor(() => expect(box).toBeEnabled());
  return box;
}

export async function ask(user: User, question: string) {
  await user.type(await composer(), question);
  await user.keyboard('{Enter}');
}

/** Stop ignores clicks for a moment after it appears, so the second click of a double-click is harmless. */
export async function pressStop(user: User) {
  await new Promise((resolve) => setTimeout(resolve, STOP_ARMS_AFTER_MS + 30));
  await user.click(screen.getByRole('button', { name: 'Stop' }));
}
