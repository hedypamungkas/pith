import { describe, expect, it } from "vitest";
import { InMemoryFreshnessCache } from "../../src/ports/nullPorts.js";
import type { ScrapeUrlResult } from "../../src/scrape/scrapeUrlCore.js";

const T0 = new Date("2026-01-01T00:00:00Z");

function content(markdown: string): ScrapeUrlResult {
  return {
    finalUrl: "https://x.test",
    title: "T",
    markdown,
    text: markdown,
    html: "",
    statusCode: 200,
    fetchedAt: T0.toISOString(),
    tierUsed: "static",
    attempts: [{ tier: "static", success: true }],
  };
}

describe("InMemoryFreshnessCache", () => {
  it("tryGet returns null for an unseen URL", async () => {
    const cache = new InMemoryFreshnessCache();
    expect(await cache.tryGet("https://nope.test")).toBeNull();
  });

  it("record + tryGet round-trips the content", async () => {
    const cache = new InMemoryFreshnessCache();
    await cache.record({
      url: "https://x.test",
      requestedTier: "news",
      requestedTierMaxStalenessSeconds: 3600,
      requestedTierProactiveRecrawl: true,
      crawledAt: T0,
      content: content("# A"),
    });
    const r = await cache.tryGet("https://x.test");
    expect(r?.content.markdown).toBe("# A");
    expect(r?.watchedTier).toBe("news");
    expect(r?.nextDueAt).toEqual(new Date(T0.getTime() + 3600 * 1000));
  });

  it("tightens monotonically: a stricter tier is adopted, a looser one is rejected", async () => {
    const cache = new InMemoryFreshnessCache();
    await cache.record({
      url: "https://x.test",
      requestedTier: "standard",
      requestedTierMaxStalenessSeconds: 86400,
      requestedTierProactiveRecrawl: false,
      crawledAt: T0,
      content: content("# standard"),
    });
    expect((await cache.tryGet("https://x.test"))?.watchedTier).toBe("standard");

    // news (3600) is stricter than standard (86400) -> adopted.
    await cache.record({
      url: "https://x.test",
      requestedTier: "news",
      requestedTierMaxStalenessSeconds: 3600,
      requestedTierProactiveRecrawl: true,
      crawledAt: T0,
      content: content("# news"),
    });
    let r = await cache.tryGet("https://x.test");
    expect(r?.watchedTier).toBe("news");
    expect(r?.watchedTierMaxStalenessSeconds).toBe(3600);

    // standard again must NOT loosen back.
    await cache.record({
      url: "https://x.test",
      requestedTier: "standard",
      requestedTierMaxStalenessSeconds: 86400,
      requestedTierProactiveRecrawl: false,
      crawledAt: T0,
      content: content("# standard-again"),
    });
    r = await cache.tryGet("https://x.test");
    expect(r?.watchedTier).toBe("news");
    expect(r?.watchedTierMaxStalenessSeconds).toBe(3600);
  });

  it("concurrent records of a new URL end on the tighter tier", async () => {
    const cache = new InMemoryFreshnessCache();
    await Promise.all([
      cache.record({
        url: "https://x.test",
        requestedTier: "news",
        requestedTierMaxStalenessSeconds: 3600,
        requestedTierProactiveRecrawl: true,
        crawledAt: T0,
        content: content("# news"),
      }),
      cache.record({
        url: "https://x.test",
        requestedTier: "standard",
        requestedTierMaxStalenessSeconds: 86400,
        requestedTierProactiveRecrawl: false,
        crawledAt: T0,
        content: content("# standard"),
      }),
    ]);
    expect((await cache.tryGet("https://x.test"))?.watchedTier).toBe("news");
  });

  it("listDue returns only proactive URLs past their nextDueAt", async () => {
    const cache = new InMemoryFreshnessCache();
    // news: proactive, due at T0+3600s.
    await cache.record({
      url: "https://news.test",
      requestedTier: "news",
      requestedTierMaxStalenessSeconds: 3600,
      requestedTierProactiveRecrawl: true,
      crawledAt: T0,
      content: content("# news"),
    });
    // standard: NOT proactive -> never due via the scheduler, even when stale.
    await cache.record({
      url: "https://std.test",
      requestedTier: "standard",
      requestedTierMaxStalenessSeconds: 1,
      requestedTierProactiveRecrawl: false,
      crawledAt: T0,
      content: content("# std"),
    });
    const beforeDue = await cache.listDue(new Date(T0.getTime() + 1800 * 1000));
    expect(beforeDue).toEqual([]);
    const afterDue = await cache.listDue(new Date(T0.getTime() + 4000 * 1000));
    expect(afterDue).toEqual([{ url: "https://news.test", watchedTier: "news" }]);
  });

  it("delete erases a row and reports whether one existed", async () => {
    const cache = new InMemoryFreshnessCache();
    await cache.record({
      url: "https://x.test",
      requestedTier: "news",
      requestedTierMaxStalenessSeconds: 3600,
      requestedTierProactiveRecrawl: true,
      crawledAt: T0,
      content: content("# A"),
    });
    expect(await cache.delete("https://x.test")).toBe(true);
    expect(await cache.tryGet("https://x.test")).toBeNull();
    expect(await cache.delete("https://x.test")).toBe(false);
  });
});
