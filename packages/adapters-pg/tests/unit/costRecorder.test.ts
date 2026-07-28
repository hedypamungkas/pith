import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { centsForTier } from "@use-pith/core";
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

  it("recordAttempts bills failed attempts at 0 cents (success-only metering)", async () => {
    const r = new PgCostRecorder(h.client);
    await r.recordAttempts([
      { tier: "static", success: true },
      { tier: "headless", success: false },
    ]);
    const { rows } = await h.client.query<{ success: boolean; cents: number }>(
      `SELECT success, cents FROM cost_events ORDER BY id`,
    );
    expect(rows).toEqual([
      { success: true, cents: centsForTier("static") },
      { success: false, cents: 0 },
    ]);
  });

  it("recordCostEvent ignores a null/undefined payload (nothing to record)", async () => {
    const r = new PgCostRecorder(h.client);
    await r.recordCostEvent(null);
    await r.recordCostEvent(undefined);
    expect(await r.hasCostEventForRequest("r1")).toBe(false);
  });

  it("recordCostEvent rejects malformed payloads loudly (no silent 0-cent row)", async () => {
    const r = new PgCostRecorder(h.client);
    // Non-null but missing/invalid requestId is a caller bug, not an idempotent no-op.
    await expect(r.recordCostEvent({ cents: 5 })).rejects.toThrow(/requestId/);
    await expect(r.recordCostEvent("oops")).rejects.toThrow(/requestId/);
    // A non-numeric cents previously coerced to 0 — billing corruption.
    await expect(
      r.recordCostEvent({ requestId: "r1" }),
    ).rejects.toThrow(/cents/);
    await expect(
      r.recordCostEvent({ requestId: "r1", cents: "5" }),
    ).rejects.toThrow(/cents/);
    await expect(
      r.recordCostEvent({ requestId: "r1", cents: NaN }),
    ).rejects.toThrow(/cents/);
    await expect(
      r.recordCostEvent({ requestId: "r1", cents: Infinity }),
    ).rejects.toThrow(/cents/);
    // A fractional cents must round upstream, never be silently floored.
    await expect(
      r.recordCostEvent({ requestId: "r1", cents: 5.5 }),
    ).rejects.toThrow(/fractional/);
    // None of the rejected events were written.
    expect(await r.hasCostEventForRequest("r1")).toBe(false);
  });

  it("recordAttempts with an empty array is a no-op", async () => {
    const r = new PgCostRecorder(h.client);
    await r.recordAttempts([]);
    expect(await r.getCostCentsForRequest("x")).toBe(0);
  });
});
