import { QuotaExceededError, TooManyConcurrentRequestsError } from '@/server/core/errors';

import type { AiRequestRepository, ReservationPolicy } from './ai-request.repository';

export interface ChatReservation {
  readonly userId: string;
  readonly documentId: string;
  readonly provider: string;
  readonly model: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly appVersion: string;
  readonly estimatedTokens: number;
}

/** Turns the repository's yes/no reservation into the typed errors the API reports. */
export class UsageService {
  constructor(
    private readonly requests: AiRequestRepository,
    private readonly policy: ReservationPolicy,
  ) {}

  async reserveChat(reservation: ChatReservation): Promise<string> {
    const result = await this.requests.reserve({ ...reservation, policy: this.policy });
    if (result.ok) return result.id;
    throw result.reason === 'concurrency'
      ? new TooManyConcurrentRequestsError(this.policy.maxConcurrent)
      : new QuotaExceededError(result.retryAfterSeconds);
  }
}
