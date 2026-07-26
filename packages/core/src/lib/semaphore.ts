/**
 * Caps concurrent access to an expensive resource independently of whatever
 * concurrency a job runner allows at the job level. Used to keep headless
 * browser contexts (memory/CPU-heavy) capped lower than the static fetch
 * tier's job concurrency.
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(maxConcurrency: number) {
    this.available = maxConcurrency;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available--;
      return () => this.release();
    }

    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.available--;
    return () => this.release();
  }

  private release(): void {
    this.available++;
    const next = this.waiters.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
