import type { MessageDto } from '@/shared/contracts/messages';
import type { ProblemDetails } from '@/shared/contracts/problem';
import type { AskEvent } from '@/shared/contracts/stream-events';

import { ApiError, type ClientErrorCode } from './api-client';
import { describeError } from './api-errors';

export type AskPhase =
  'idle' | 'sending' | 'retrieving' | 'generating' | 'streaming' | 'done' | 'error' | 'cancelled';

/** Busy phases in the order a healthy exchange moves through them. */
const BUSY_ORDER = ['sending', 'retrieving', 'generating', 'streaming'] as const;
const rank = (phase: AskPhase) => (BUSY_ORDER as readonly string[]).indexOf(phase);

export type BusyPhase = (typeof BUSY_ORDER)[number];

export const isBusy = (phase: AskPhase): phase is BusyPhase => rank(phase) >= 0;

export interface AskFailure {
  readonly code: ClientErrorCode;
  /** Already worded for a person. */
  readonly message: string;
  readonly retryAfterSeconds?: number;
}

export interface AskState {
  readonly phase: AskPhase;
  readonly question: string;
  /** Set once the server has stored the question; from then on the thread shows it. */
  readonly userMessage: MessageDto | null;
  readonly text: string;
  readonly message: MessageDto | null;
  readonly failure: AskFailure | null;
}

export type AskAction =
  | { readonly type: 'start'; readonly question: string }
  | { readonly type: 'event'; readonly event: AskEvent }
  | { readonly type: 'failed'; readonly failure: AskFailure }
  | { readonly type: 'cancelled' }
  | { readonly type: 'reset' };

export const initialAskState: AskState = {
  phase: 'idle',
  question: '',
  userMessage: null,
  text: '',
  message: null,
  failure: null,
};

export function toFailure(error: ApiError): AskFailure {
  return {
    code: error.code,
    message: describeError(error),
    ...(error.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: error.retryAfterSeconds }),
  };
}

const failureFromProblem = (problem: ProblemDetails): AskFailure =>
  toFailure(
    new ApiError(
      problem.status,
      problem.code,
      problem.detail ?? problem.title,
      problem.retryAfterSeconds,
      problem.errors ?? [],
    ),
  );

function applyEvent(state: AskState, event: AskEvent): AskState {
  switch (event.type) {
    case 'accepted':
      return { ...state, userMessage: event.userMessage };
    case 'status':
      return rank(event.phase) > rank(state.phase) ? { ...state, phase: event.phase } : state;
    case 'delta':
      return { ...state, phase: 'streaming', text: state.text + event.text };
    case 'final':
      return { ...state, phase: 'done', message: event.message };
    case 'error':
      return { ...state, phase: 'error', failure: failureFromProblem(event.problem) };
  }
}

/** The whole life of one question as a state machine; anything out of order is ignored, never trusted. */
export function askReducer(state: AskState, action: AskAction): AskState {
  switch (action.type) {
    case 'start':
      return isBusy(state.phase)
        ? state
        : { ...initialAskState, phase: 'sending', question: action.question };
    case 'reset':
      return initialAskState;
    case 'event':
      return isBusy(state.phase) ? applyEvent(state, action.event) : state;
    case 'failed':
      return isBusy(state.phase) ? { ...state, phase: 'error', failure: action.failure } : state;
    case 'cancelled':
      return isBusy(state.phase) ? { ...state, phase: 'cancelled' } : state;
  }
}
