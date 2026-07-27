import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIER_CATALOG,
  resolveTier,
  UnknownFreshnessTierError,
  type FreshnessTierCatalog,
} from "../../src/freshness/freshnessTiers.js";

describe("freshnessTiers", () => {
  it("DEFAULT_TIER_CATALOG seeds news + standard with the source's values + proactive asymmetry", () => {
    expect(DEFAULT_TIER_CATALOG.news).toEqual({
      name: "news",
      maxStalenessSeconds: 3600,
      proactiveRecrawl: true,
    });
    expect(DEFAULT_TIER_CATALOG.standard).toEqual({
      name: "standard",
      maxStalenessSeconds: 86400,
      proactiveRecrawl: false,
    });
  });

  it("resolveTier returns the def with name normalized to the lookup key", () => {
    const tier = resolveTier(DEFAULT_TIER_CATALOG, "news");
    expect(tier.name).toBe("news");
    expect(tier.maxStalenessSeconds).toBe(3600);
    expect(tier.proactiveRecrawl).toBe(true);
  });

  it("resolveTier throws UnknownFreshnessTierError on a miss", () => {
    expect(() => resolveTier(DEFAULT_TIER_CATALOG, "nope")).toThrow(UnknownFreshnessTierError);
  });

  it("honors a caller-supplied catalog override", () => {
    const custom: FreshnessTierCatalog = {
      sports: { name: "sports", maxStalenessSeconds: 1800, proactiveRecrawl: true },
    };
    expect(resolveTier(custom, "sports").maxStalenessSeconds).toBe(1800);
    expect(() => resolveTier(custom, "news")).toThrow(UnknownFreshnessTierError);
  });
});
