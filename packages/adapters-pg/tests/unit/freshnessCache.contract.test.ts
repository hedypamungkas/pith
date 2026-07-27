import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ScrapeUrlResult } from "@use-pith/core";
import { makePglite, type PgliteHandle } from "../helpers/pglite.js";
import { PgFreshnessCache } from "../../src/freshnessCache.js";

let h: PgliteHandle;
beforeEach(async () => {
  h = await makePglite();
});
afterEach(async () => {
  await h.close();
});

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

// Contract parity with @use-pith/core's InMemoryFreshnessCache
// (packages/core/tests/unit/inMemoryFreshnessCache.test.ts).
describe("PgFreshnessCache (contract parity)", () => {
  it("tryGet returns null for an unseen URL", async () => {
    const cache = new PgFreshnessCache(h.client);
    expect(await cache.tryGet("https://nope.test")).toBeNull();
  });

  it("record + tryGet round-trips the content", async () => {
    const cache = new PgFreshnessCache(h.client);
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
    const cache = new PgFreshnessCache(h.client);
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
    const cache = new PgFreshnessCache(h.client);
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
    const cache = new PgFreshnessCache(h.client);
    await cache.record({
      url: "https://news.test",
      requestedTier: "news",
      requestedTierMaxStalenessSeconds: 3600,
      requestedTierProactiveRecrawl: true,
      crawledAt: T0,
      content: content("# news"),
    });
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
    const cache = new PgFreshnessCache(h.client);
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
