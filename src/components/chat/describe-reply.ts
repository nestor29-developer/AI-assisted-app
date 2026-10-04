import type { MessageDto } from '@/shared/contracts/messages';

import { describeBadges } from './confidence-badge';

/** What a screen reader hears once when a reply lands: the same words the card's badges use. */
export function describeReply(message: MessageDto): string {
  if (message.status === 'failed') return 'Could not get an answer.';
  if (message.status === 'cancelled') return 'The answer was cut short.';
  if (!message.answer) return 'Answer ready.';
  return `Answer ready: ${describeBadges(message.answer).join(', ')}`;
}
