import { describe, it, expect } from "vitest";
import {
  normalizeQueueConnection,
  normalizeBlockingConnection,
} from "../../src/connection.js";

// All key-free: these exercise the OPTIONS branches only. The ioredis-instance
// branch is a trivial `instanceof` passthrough covered by the integration suite
// (constructing an instance key-free would open a socket / emit error events).

describe("connection normalization", () => {
  it("normalizeQueueConnection passes options through unchanged", () => {
    const opts = { host: "127.0.0.1", port: 6379 };
    expect(normalizeQueueConnection(opts)).toEqual(opts);
    // The producer (Queue) side does NOT need maxRetriesPerRequest disabled.
    expect(
      (normalizeQueueConnection(opts) as { maxRetriesPerRequest?: number })
        .maxRetriesPerRequest,
    ).toBeUndefined();
  });

  it("normalizeBlockingConnection forces maxRetriesPerRequest:null (BullMQ worker/queueevents requirement)", () => {
    const out = normalizeBlockingConnection({
      host: "127.0.0.1",
      port: 6379,
    }) as { host: string; maxRetriesPerRequest: null };
    expect(out.host).toBe("127.0.0.1");
    expect(out.maxRetriesPerRequest).toBeNull();
  });

  it("normalizeBlockingConnection overrides an existing maxRetriesPerRequest", () => {
    const out = normalizeBlockingConnection({
      maxRetriesPerRequest: 3,
    }) as { maxRetriesPerRequest: null };
    expect(out.maxRetriesPerRequest).toBeNull();
  });

  it("normalizeBlockingConnection does not mutate the caller's options", () => {
    const opts = { host: "127.0.0.1" } as { host: string; maxRetriesPerRequest?: number };
    normalizeBlockingConnection(opts);
    expect(opts.maxRetriesPerRequest).toBeUndefined();
  });
});
