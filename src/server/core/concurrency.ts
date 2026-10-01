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
