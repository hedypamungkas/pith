import { describe, it, expect } from "vitest";
import {
  SCRAPE_QUEUE,
  CRAWL_QUEUE,
  EXTRACT_QUEUE,
  SCRAPE_JOB,
  CRAWL_JOB,
  EXTRACT_JOB,
  DEFAULT_JOB_OPTIONS,
} from "../../src/queueNames.js";

describe("queue names (producer ↔ worker agreement)", () => {
  it("the three queues are distinct (and contain no ':' — BullMQ forbids it in names)", () => {
    expect(new Set([SCRAPE_QUEUE, CRAWL_QUEUE, EXTRACT_QUEUE]).size).toBe(3);
    expect(SCRAPE_QUEUE).toBe("pith-scrape");
    expect(CRAWL_QUEUE).toBe("pith-crawl");
    expect(EXTRACT_QUEUE).toBe("pith-extract");
    for (const q of [SCRAPE_QUEUE, CRAWL_QUEUE, EXTRACT_QUEUE]) {
      expect(q).not.toMatch(/:/);
    }
  });

  it("the job names are distinct within their single-purpose queues", () => {
    expect(new Set([SCRAPE_JOB, CRAWL_JOB, EXTRACT_JOB]).size).toBe(3);
  });
});

describe("DEFAULT_JOB_OPTIONS (the BullMQ removeOnComplete guard)", () => {
  it("removeOnComplete is a bounded count, never bare true", () => {
    // Bare `true` races `waitUntilFinished` (BullMQ #85); on the Worker it is
    // broken outright (BullMQ #2620). A bounded count keeps the returnvalue
    // readable until the producer fetches it.
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete).not.toBe(true);
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete).toEqual({ count: 1000 });
  });

  it("removeOnFail is a bounded count too (Redis growth is capped)", () => {
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).not.toBe(true);
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).toEqual({ count: 5000 });
  });

  it("is frozen so a host cannot mutate it back to bare true at runtime", () => {
    expect(Object.isFrozen(DEFAULT_JOB_OPTIONS)).toBe(true);
  });
});
