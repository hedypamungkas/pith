import { describe, it, expect } from "vitest";
import { Semaphore } from "../../src/lib/semaphore.js";

describe("Semaphore", () => {
  it("runs up to maxConcurrency concurrently and blocks the rest", async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let maxActive = 0;
    const task = async (): Promise<void> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
    };
    await Promise.all([
      sem.run(task),
      sem.run(task),
      sem.run(task),
      sem.run(task),
    ]);
    expect(maxActive).toBe(2);
  });

  it("resumes waiters in FIFO registration order", async () => {
    const sem = new Semaphore(1);
    const order: string[] = [];
    const hold = await sem.acquire(); // saturate the single slot
    const p1 = sem.run(async () => {
      order.push("a");
    });
    const p2 = sem.run(async () => {
      order.push("b");
    });
    const p3 = sem.run(async () => {
      order.push("c");
    });
    await new Promise((r) => setTimeout(r, 5)); // let waiters register
    hold();
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("releases the slot even when run's fn throws", async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // The slot must be free again — a second run resolves promptly.
    let ran = false;
    await sem.run(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("acquire() returns a release callback that frees a slot for a blocked waiter", async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquire();
    let reached = false;
    const p = sem.acquire().then((rel) => {
      reached = true;
      rel();
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(reached).toBe(false);
    release();
    await p;
    expect(reached).toBe(true);
  });
});
