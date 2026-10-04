/** Tabs of one browser share the session cookie, so signing out in one has to reach the others. */
const CHANNEL_NAME = 'docqa-auth';
const SIGNED_OUT = 'signed-out';

// A channel never hears its own messages, so one per tab is exactly "signed out somewhere else".
let channel: BroadcastChannel | undefined;

function sharedChannel(): BroadcastChannel | undefined {
  if (typeof BroadcastChannel === 'undefined') return undefined;
  channel ??= new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

export function announceSignedOut(): void {
  sharedChannel()?.postMessage(SIGNED_OUT);
}

/** Returns the function that stops listening. */
export function onSignedOutElsewhere(listener: () => void): () => void {
  const target = sharedChannel();
  if (!target) return () => undefined;

  const handle = (event: MessageEvent) => {
    if (event.data === SIGNED_OUT) listener();
  };
  target.addEventListener('message', handle);
  return () => target.removeEventListener('message', handle);
}
