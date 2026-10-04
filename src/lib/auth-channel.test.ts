import { afterEach, describe, expect, it, vi } from 'vitest';

import { announceSignedOut, onSignedOutElsewhere } from './auth-channel';

const pause = () => new Promise((resolve) => setTimeout(resolve, 25));

/** What another tab sends; the name and the payload are the contract under test. */
function otherTab() {
  const channel = new BroadcastChannel('docqa-auth');
  const heard = vi.fn();
  channel.onmessage = heard;
  return {
    heard,
    send: (message: string) => channel.postMessage(message),
    close: () => channel.close(),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('signing out across tabs', () => {
  it('tells a listener when another tab signs out', async () => {
    const listener = vi.fn();
    const stop = onSignedOutElsewhere(listener);
    const tab = otherTab();

    tab.send('signed-out');

    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    stop();
    tab.close();
  });

  it('reaches another tab when this one announces it', async () => {
    const tab = otherTab();

    announceSignedOut();

    await vi.waitFor(() => expect(tab.heard).toHaveBeenCalledTimes(1));
    expect(tab.heard.mock.calls[0]?.[0]).toMatchObject({ data: 'signed-out' });
    tab.close();
  });

  it('does not tell the tab that signed out about its own sign-out', async () => {
    const own = vi.fn();
    const stop = onSignedOutElsewhere(own);
    const tab = otherTab();

    announceSignedOut();
    await vi.waitFor(() => expect(tab.heard).toHaveBeenCalledTimes(1));
    await pause();

    expect(own).not.toHaveBeenCalled();
    stop();
    tab.close();
  });

  it('ignores anything else sent on the channel', async () => {
    const listener = vi.fn();
    const stop = onSignedOutElsewhere(listener);
    const tab = otherTab();

    tab.send('something-else');
    tab.send('signed-out');

    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    await pause();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    tab.close();
  });

  it('stops listening once the returned function is called', async () => {
    const stopped = vi.fn();
    const marker = vi.fn();
    onSignedOutElsewhere(stopped)();
    const stopMarker = onSignedOutElsewhere(marker);
    const tab = otherTab();

    tab.send('signed-out');
    await vi.waitFor(() => expect(marker).toHaveBeenCalledTimes(1));

    expect(stopped).not.toHaveBeenCalled();
    stopMarker();
    tab.close();
  });

  it('does nothing, and does not throw, where the browser has no BroadcastChannel', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const stop = onSignedOutElsewhere(() => undefined);

    expect(() => announceSignedOut()).not.toThrow();
    expect(() => stop()).not.toThrow();
  });
});
