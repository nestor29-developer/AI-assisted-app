import { ServiceBusyError } from './errors';

/** Caps parallel work and queues a bounded number of waiters; past that it sheds load with a 503. */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueued: number,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
    } else if (this.waiting.length >= this.maxQueued) {
      throw new ServiceBusyError();
    } else {
      // The releasing task hands its slot straight to us, so `active` is unchanged.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }

    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}

/** Maps with at most `limit` calls in flight; results keep input order, and the first failure wins. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
