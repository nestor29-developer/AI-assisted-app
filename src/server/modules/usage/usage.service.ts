import { QuotaExceededError, TooManyConcurrentRequestsError } from '@/server/core/errors';

import type { AiRequestRepository, ReservationPolicy } from './ai-request.repository';

const STALE_RESERVATION_SLACK_SECONDS = 60;

/** A reservation older than the model timeout plus some slack belongs to a task that died. */
export const staleAfterSeconds = (llmTimeoutMs: number): number =>
  Math.ceil(llmTimeoutMs / 1000) + STALE_RESERVATION_SLACK_SECONDS;

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
