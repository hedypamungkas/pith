import { describe, it, expect } from "vitest";
import {
  centsForTier,
  DEFAULT_TIER_PRICE_CENTS,
  type Tier,
} from "../../src/pricing.js";

describe("pricing", () => {
  it("returns the default table value for each tier", () => {
    expect(centsForTier("static")).toBe(1);
    expect(centsForTier("headless")).toBe(5);
    expect(centsForTier("search")).toBe(2);
    expect(centsForTier("extraction")).toBe(10);
    expect(centsForTier("cache")).toBe(0);
    expect(centsForTier("stealth")).toBe(0);
  });

  it("honors a custom table override", () => {
    const custom = { ...DEFAULT_TIER_PRICE_CENTS, headless: 7, static: 3 };
    expect(centsForTier("headless", custom)).toBe(7);
    expect(centsForTier("static", custom)).toBe(3);
  });

  it("returns values verbatim with no negative/zero guard (documented pass-through)", () => {
    const weird = { ...DEFAULT_TIER_PRICE_CENTS, static: -5, extraction: 0 };
    expect(centsForTier("static", weird)).toBe(-5);
    expect(centsForTier("extraction", weird)).toBe(0);
  });

  it("DEFAULT_TIER_PRICE_CENTS covers every Tier", () => {
    const tiers: Tier[] = [
      "static",
      "headless",
      "stealth",
      "search",
      "extraction",
      "cache",
    ];
    for (const t of tiers) {
      expect(typeof DEFAULT_TIER_PRICE_CENTS[t]).toBe("number");
    }
  });
});
