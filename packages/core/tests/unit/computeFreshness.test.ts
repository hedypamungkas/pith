import { describe, expect, it } from "vitest";
import { computeFreshness } from "../../src/freshness/computeFreshness.js";
import { DEFAULT_TIER_CATALOG, resolveTier } from "../../src/freshness/freshnessTiers.js";

const crawledAt = new Date("2026-01-01T00:00:00Z");
const news = resolveTier(DEFAULT_TIER_CATALOG, "news");
const standard = resolveTier(DEFAULT_TIER_CATALOG, "standard");

describe("computeFreshness", () => {
  it("is within SLA at exactly the max-staleness boundary (<=)", () => {
    const onBoundary = new Date("2026-01-01T01:00:00Z"); // +3600s
    expect(computeFreshness(news, crawledAt, onBoundary).withinSla).toBe(true);
  });

  it("is out of SLA one second past the boundary", () => {
    const past = new Date("2026-01-01T01:00:01Z"); // +3601s
    expect(computeFreshness(news, crawledAt, past).withinSla).toBe(false);
  });

  it("reports ISO crawledAt, the slaTier, and the tier's maxStalenessSeconds", () => {
    const info = computeFreshness(news, crawledAt, new Date("2026-01-01T00:30:00Z"));
    expect(info.crawledAt).toBe("2026-01-01T00:00:00.000Z");
    expect(info.slaTier).toBe("news");
    expect(info.maxStalenessSeconds).toBe(3600);
    expect(info.withinSla).toBe(true);
  });

  it("a stricter tier goes stale sooner than a looser one for the same crawl", () => {
    const later = new Date("2026-01-01T05:00:00Z"); // +5h
    expect(computeFreshness(news, crawledAt, later).withinSla).toBe(false); // news 1h
    expect(computeFreshness(standard, crawledAt, later).withinSla).toBe(true); // standard 24h
  });
});
