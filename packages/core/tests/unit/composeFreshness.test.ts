import { describe, expect, it, vi } from "vitest";
import { composeFreshness } from "../../src/freshness/composeFreshness.js";
import { DEFAULT_TIER_CATALOG } from "../../src/freshness/freshnessTiers.js";
import { InMemoryFreshnessCache } from "../../src/ports/nullPorts.js";
import type { ScrapeUrlResult } from "../../src/scrape/scrapeUrlCore.js";

const URL = "https://x.test";
const FETCHED_AT = "2026-01-01T00:00:00.000Z";

function makeResult(markdown = "# Hello"): ScrapeUrlResult {
  return {
    finalUrl: URL,
    title: "T",
    markdown,
    text: markdown,
    html: "",
    statusCode: 200,
    fetchedAt: FETCHED_AT,
    tierUsed: "static",
    attempts: [{ tier: "static", success: true }],
  };
}

/** Mutable fake clock — reassign `now` to advance time. */
function fakeClock() {
  let current = new Date("2026-01-01T00:00:00Z");
  return { clock: () => current, set: (d: Date) => (current = d) };
}

describe("composeFreshness (stale-while-revalidate)", () => {
  it("miss → fetches + records; fresh hit → serves cached with no fetch", async () => {
    const cache = new InMemoryFreshnessCache();
    const { clock, set } = fakeClock();
    const scrape = vi.fn(async () => makeResult("# A"));
    const fresh = composeFreshness(scrape, {
      cache,
      tierCatalog: DEFAULT_TIER_CATALOG,
      clock,
    });

    const r1 = await fresh(URL, { freshnessTier: "news" });
    expect(r1.fromCache).toBe(false);
    expect(r1.freshness.withinSla).toBe(true);
    expect(scrape).toHaveBeenCalledTimes(1);

    // Still within news's 1h SLA -> served from cache, no new fetch.
    set(new Date("2026-01-01T00:30:00Z"));
    const r2 = await fresh(URL, { freshnessTier: "news" });
    expect(r2.fromCache).toBe(true);
    expect(r2.freshness.withinSla).toBe(true);
    expect(r2.markdown).toBe("# A");
    expect(scrape).toHaveBeenCalledTimes(1);
  });

  it("past the SLA → refetches and re-records (fromCache:false)", async () => {
    const cache = new InMemoryFreshnessCache();
    const { clock, set } = fakeClock();
    const scrape = vi.fn(async () => makeResult("# A"));
    const fresh = composeFreshness(scrape, {
      cache,
      tierCatalog: DEFAULT_TIER_CATALOG,
      clock,
    });

    await fresh(URL, { freshnessTier: "news" });
    set(new Date("2026-01-01T02:00:00Z")); // +2h, past the 1h news SLA
    const r2 = await fresh(URL, { freshnessTier: "news" });
    expect(r2.fromCache).toBe(false);
    expect(scrape).toHaveBeenCalledTimes(2);
  });

  it("stale fallback: a refetch failure serves the stale content (withinSla:false)", async () => {
    const cache = new InMemoryFreshnessCache();
    const { clock, set } = fakeClock();
    let shouldFail = false;
    const scrape = vi.fn(async () => {
      if (shouldFail) throw new Error("upstream blew up");
      return makeResult("# A");
    });
    const fresh = composeFreshness(scrape, {
      cache,
      tierCatalog: DEFAULT_TIER_CATALOG,
      clock,
      recrawlTimeoutMs: 5000,
    });

    await fresh(URL, { freshnessTier: "news" }); // prime the cache
    set(new Date("2026-01-01T02:00:00Z")); // stale
    shouldFail = true;
    const r = await fresh(URL, { freshnessTier: "news" });
    expect(r.fromCache).toBe(true);
    expect(r.freshness.withinSla).toBe(false);
    expect(r.markdown).toBe("# A"); // the stale content, not a throw
  });

  it("no stale row + fetch failure -> rethrows (nothing to fall back to)", async () => {
    const cache = new InMemoryFreshnessCache();
    const { clock } = fakeClock();
    const scrape = vi.fn(async () => {
      throw new Error("boom");
    });
    const fresh = composeFreshness(scrape, {
      cache,
      tierCatalog: DEFAULT_TIER_CATALOG,
      clock,
    });
    await expect(fresh(URL, { freshnessTier: "news" })).rejects.toThrow("boom");
  });

  it("unknown tier -> UnknownFreshnessTierError before any fetch", async () => {
    const cache = new InMemoryFreshnessCache();
    const { clock } = fakeClock();
    const scrape = vi.fn(async () => makeResult());
    const fresh = composeFreshness(scrape, {
      cache,
      tierCatalog: DEFAULT_TIER_CATALOG,
      clock,
    });
    await expect(fresh(URL, { freshnessTier: "nope" })).rejects.toThrow(
      /Unknown freshness tier/,
    );
    expect(scrape).not.toHaveBeenCalled();
  });

  it("defaults to the standard tier when freshnessTier is set but unqualified", async () => {
    const cache = new InMemoryFreshnessCache();
    const { clock, set } = fakeClock();
    const scrape = vi.fn(async () => makeResult());
    const fresh = composeFreshness(scrape, {
      cache,
      tierCatalog: DEFAULT_TIER_CATALOG,
      clock,
    });
    const r1 = await fresh(URL, { freshnessTier: "standard" });
    expect(r1.fromCache).toBe(false);
    // standard is 24h; +2h is still fresh.
    set(new Date("2026-01-01T02:00:00Z"));
    const r2 = await fresh(URL, { freshnessTier: "standard" });
    expect(r2.fromCache).toBe(true);
    expect(r2.freshness.slaTier).toBe("standard");
  });
});
