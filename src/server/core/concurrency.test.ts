import { describe, expect, it } from 'vitest';

import { ConcurrencyLimiter, mapConcurrent } from './concurrency';
import { ServiceBusyError } from './errors';

/** A task that stays running until released, so tests control exactly what overlaps. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ConcurrencyLimiter', () => {
  it('runs at most maxConcurrent tasks at once and starts queued ones as slots free up', async () => {
    const limiter = new ConcurrencyLimiter(2, 10);
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, gate);

    const results = gates.map((g, index) =>
      limiter.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await g.opened;
        running -= 1;
        return index;
      }),
    );
    await tick();
    expect(running).toBe(2);

    for (const g of gates) {
      g.open();
      await tick();
    }

    expect(await Promise.all(results)).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
  });

  it('sheds load once the queue is full, without disturbing work already accepted', async () => {
    const limiter = new ConcurrencyLimiter(1, 1);
    const first = gate();
    const second = gate();
    const running = limiter.run(() => first.opened);
    const queued = limiter.run(() => second.opened);
    await tick();

    await expect(limiter.run(async () => 'overflow')).rejects.toBeInstanceOf(ServiceBusyError);

    first.open();
    second.open();
    await expect(Promise.all([running, queued])).resolves.toBeDefined();
  });

  it('frees the slot when a task throws, so one failure cannot wedge the limiter', async () => {
    const limiter = new ConcurrencyLimiter(1, 0);

    await expect(limiter.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );

    await expect(limiter.run(async () => 'still works')).resolves.toBe('still works');
  });
});

describe('mapConcurrent', () => {
  it('keeps results in input order while never exceeding the limit', async () => {
    let running = 0;
    let peak = 0;

    const results = await mapConcurrent([30, 5, 20, 1, 10], 2, async (delay, index) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, delay));
      running -= 1;
      return `item-${index}`;
    });

    expect(results).toEqual(['item-0', 'item-1', 'item-2', 'item-3', 'item-4']);
    expect(peak).toBe(2);
  });

  it('handles an empty list and a limit larger than the list', async () => {
    expect(await mapConcurrent([], 3, async () => 1)).toEqual([]);
    expect(await mapConcurrent([1, 2], 10, async (n) => n * 2)).toEqual([2, 4]);
  });

  it('rejects with the first failure', async () => {
    await expect(
      mapConcurrent([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('second failed');
        return n;
      }),
    ).rejects.toThrow('second failed');
  });
});
