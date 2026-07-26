import { describe, it, expect } from "vitest";
import {
  fetchBudgetFrom,
  canAffordTier,
  describeFetchBudgetOutcome,
} from "../../src/fetchBudget.js";
import { centsForTier } from "../../src/pricing.js";

describe("fetchBudgetFrom", () => {
  it("passes undefined through", () => {
    expect(fetchBudgetFrom(undefined)).toBeUndefined();
  });
  it("builds a budget with default otherCommittedCents=0", () => {
    expect(fetchBudgetFrom(100)).toEqual({
      rawBudgetCents: 100,
      otherCommittedCents: 0,
    });
  });
  it("carries otherCommittedCents", () => {
    expect(fetchBudgetFrom(100, 10)).toEqual({
      rawBudgetCents: 100,
      otherCommittedCents: 10,
    });
  });
});

describe("canAffordTier", () => {
  it("is always affordable with no budget", () => {
    expect(canAffordTier(undefined, "headless", centsForTier)).toBe(true);
  });
  it("affords exactly-equal remaining (<= boundary)", () => {
    // budget 5, committed 0, spent 0 → remaining 5; headless=5 → 5<=5 true
    expect(canAffordTier(fetchBudgetFrom(5), "headless", centsForTier, 0)).toBe(
      true,
    );
  });
  it("5-cent edge: already-billed static (spent 1) means headless (5) no longer fits a 5-cent budget", () => {
    // remaining = 5 - 0 - 1 = 4; 5 <= 4 false
    expect(canAffordTier(fetchBudgetFrom(5), "headless", centsForTier, 1)).toBe(
      false,
    );
  });
  it("accounts for otherCommittedCents", () => {
    expect(canAffordTier(fetchBudgetFrom(6, 1), "headless", centsForTier, 0)).toBe(
      true,
    ); // remaining 5; 5<=5
    expect(canAffordTier(fetchBudgetFrom(5, 1), "headless", centsForTier, 0)).toBe(
      false,
    ); // remaining 4; 5<=4
  });
});

describe("describeFetchBudgetOutcome", () => {
  it("within-budget → applied false", () => {
    const out = describeFetchBudgetOutcome(
      fetchBudgetFrom(100)!,
      5,
      "static",
      null,
      centsForTier,
    );
    expect(out.applied).toBe(false);
    expect(out.tierServed).toBe("static");
  });
  it("strict-> exceeded boundary: equal cost is NOT exceeded", () => {
    // totalCost = 0 + 6; budget 6 → 6 > 6 false → within budget
    expect(
      describeFetchBudgetOutcome(fetchBudgetFrom(6)!, 6, "headless", null, centsForTier)
        .applied,
    ).toBe(false);
  });
  it("exceeded-only → applied true, no skippedTier", () => {
    // totalCost 7 > budget 6 → exceeded
    const out = describeFetchBudgetOutcome(
      fetchBudgetFrom(6)!,
      7,
      "headless",
      null,
      centsForTier,
    );
    expect(out.applied).toBe(true);
    expect(out.skippedTier).toBeUndefined();
  });
  it("escalation skipped → applied true with skippedTier + cost", () => {
    const out = describeFetchBudgetOutcome(
      fetchBudgetFrom(5)!,
      1,
      "static",
      { tier: "headless" },
      centsForTier,
    );
    expect(out.applied).toBe(true);
    expect(out.skippedTier).toBe("headless");
    expect(out.skippedTierCostCents).toBe(5);
  });
});
