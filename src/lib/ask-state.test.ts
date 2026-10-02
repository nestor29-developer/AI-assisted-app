import { describe, expect, it } from 'vitest';

import { makeAssistantMessage, makeUserMessage } from '@/test/fixtures/messages';
import type { AskEvent } from '@/shared/contracts/stream-events';

import { ApiError } from './api-client';
import {
  askReducer,
  initialAskState,
  isBusy,
  toFailure,
  type AskAction,
  type AskState,
} from './ask-state';

const run = (actions: AskAction[], from: AskState = initialAskState) =>
  actions.reduce(askReducer, from);
const event = (e: AskEvent): AskAction => ({ type: 'event', event: e });

const userMessage = makeUserMessage();
const finalMessage = makeAssistantMessage();

const started = run([{ type: 'start', question: 'How many days?' }]);

describe('askReducer: a healthy exchange', () => {
  it('walks sending, retrieving, generating, streaming and done, collecting the text', () => {
    const phases: string[] = [];
    let state = initialAskState;
    const feed = (action: AskAction) => {
      state = askReducer(state, action);
      phases.push(state.phase);
    };

    feed({ type: 'start', question: 'How many days?' });
    feed(event({ type: 'accepted', userMessage }));
    feed(event({ type: 'status', phase: 'retrieving' }));
    feed(event({ type: 'status', phase: 'generating' }));
    feed(event({ type: 'delta', text: 'Employees ' }));
    feed(event({ type: 'delta', text: 'accrue days.' }));
    feed(event({ type: 'final', message: finalMessage }));

    expect(phases).toEqual([
      'sending',
      'sending',
      'retrieving',
      'generating',
      'streaming',
      'streaming',
      'done',
    ]);
    expect(state).toMatchObject({
      question: 'How many days?',
      userMessage,
      text: 'Employees accrue days.',
      message: finalMessage,
      failure: null,
    });
  });

  it('starts over cleanly after a finished exchange', () => {
    const done = run([event({ type: 'final', message: finalMessage })], started);

    const next = askReducer(done, { type: 'start', question: 'Another?' });

    expect(next).toEqual({ ...initialAskState, phase: 'sending', question: 'Another?' });
  });

  it('can be reset to idle', () => {
    expect(askReducer(started, { type: 'reset' })).toEqual(initialAskState);
  });
});

describe('askReducer: things that go wrong', () => {
  it('records a refusal before the stream as an error', () => {
    const failure = toFailure(new ApiError(429, 'RATE_LIMITED', 'x', 30));

    const state = askReducer(started, { type: 'failed', failure });

    expect(state.phase).toBe('error');
    expect(state.failure).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many requests. Try again in 30 seconds.',
      retryAfterSeconds: 30,
    });
  });

  it('turns an error event from the stream into a described failure, keeping the text so far', () => {
    const state = run(
      [
        event({ type: 'delta', text: 'Partial ' }),
        event({
          type: 'error',
          problem: {
            type: 'urn:problem:ai-unavailable',
            title: 'AI unavailable',
            status: 503,
            code: 'AI_UNAVAILABLE',
          },
        }),
      ],
      started,
    );

    expect(state.phase).toBe('error');
    expect(state.text).toBe('Partial ');
    expect(state.failure).toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(state.failure?.message).toContain('not responding');
  });

  it('records that the user pressed Stop, keeping the text so far', () => {
    const state = run(
      [event({ type: 'delta', text: 'Half an ans' }), { type: 'cancelled' }],
      started,
    );

    expect(state).toMatchObject({ phase: 'cancelled', text: 'Half an ans' });
  });
});

describe('askReducer: it never trusts events that are out of order', () => {
  it('never moves the status backwards', () => {
    const generating = run([event({ type: 'status', phase: 'generating' })], started);

    expect(askReducer(generating, event({ type: 'status', phase: 'retrieving' })).phase).toBe(
      'generating',
    );
    const streaming = run([event({ type: 'delta', text: 'x' })], generating);
    expect(askReducer(streaming, event({ type: 'status', phase: 'generating' })).phase).toBe(
      'streaming',
    );
  });

  it('ignores a second start while one is running, so a question is never sent twice', () => {
    expect(askReducer(started, { type: 'start', question: 'Another?' })).toBe(started);
  });

  it.each([
    ['an event', event({ type: 'delta', text: 'late' })],
    [
      'a failure',
      { type: 'failed', failure: toFailure(new ApiError(0, 'NETWORK_ERROR', 'x')) } as const,
    ],
    ['a cancel', { type: 'cancelled' } as const],
  ])('ignores %s when nothing is running', (_label, action) => {
    expect(askReducer(initialAskState, action)).toBe(initialAskState);
    const done = run([event({ type: 'final', message: finalMessage })], started);
    expect(askReducer(done, action)).toBe(done);
  });
});

describe('isBusy', () => {
  it('is true only while a question is in flight', () => {
    expect(
      (['sending', 'retrieving', 'generating', 'streaming'] as const).every((p) => isBusy(p)),
    ).toBe(true);
    expect((['idle', 'done', 'error', 'cancelled'] as const).some((p) => isBusy(p))).toBe(false);
  });
});
