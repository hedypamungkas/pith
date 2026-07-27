import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makePglite, type PgliteHandle } from "../helpers/pglite.js";
import { PgCostRecorder } from "../../src/costRecorder.js";

let h: PgliteHandle;
beforeEach(async () => {
  h = await makePglite();
});
afterEach(async () => {
  await h.close();
});

describe("PgCostRecorder", () => {
  it("recordAttempts logs attempts; per-request lookups stay 0 (no requestId)", async () => {
    const r = new PgCostRecorder(h.client);
    await r.recordAttempts([
      { tier: "static", success: true },
      { tier: "headless", success: false },
    ]);
    expect(await r.getCostCentsForRequest("any")).toBe(0);
    expect(await r.hasCostEventForRequest("any")).toBe(false);
  });

  it("recordCostEvent writes requestId-linked ledger entries that sum", async () => {
    const r = new PgCostRecorder(h.client);
    await r.recordCostEvent({ requestId: "r1", cents: 5, tier: "static" });
    await r.recordCostEvent({ requestId: "r1", cents: 3, tier: "headless" });
    expect(await r.hasCostEventForRequest("r1")).toBe(true);
    expect(await r.getCostCentsForRequest("r1")).toBe(8);
    expect(await r.getCostCentsForRequest("missing")).toBe(0);
  });

  it("recordCostEvent ignores payloads without a requestId", async () => {
    const r = new PgCostRecorder(h.client);
    await r.recordCostEvent({ cents: 5 });
    await r.recordCostEvent(null);
    expect(await r.hasCostEventForRequest("r1")).toBe(false);
  });

  it("recordAttempts with an empty array is a no-op", async () => {
    const r = new PgCostRecorder(h.client);
    await r.recordAttempts([]);
    expect(await r.getCostCentsForRequest("x")).toBe(0);
  });
});
