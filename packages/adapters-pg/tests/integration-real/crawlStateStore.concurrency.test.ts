import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgFromEnv, type PgHandle } from "../helpers/pg.js";
import { PgCrawlStateStore } from "../../src/crawlStateStore.js";
import { PgFreshnessCache } from "../../src/freshnessCache.js";

// Real Postgres (not PGlite): exercises the FOR UPDATE row lock and multi-
// connection parallelism the unit (PGlite, single-threaded) suite can't
// faithfully cover. Gated — skipped unless PG_DATABASE_URL is set, so the
// key-free `ci.yml` matrix stays green; runs in adapters-nightly.yml.
describe.skipIf(!process.env.PG_DATABASE_URL)(
  "PgCrawlStateStore concurrency (real Postgres)",
  () => {
    let pg: PgHandle;

    beforeAll(async () => {
      pg = await pgFromEnv();
    });
    afterAll(async () => {
      await pg.close();
    });

    it("serialized inserts never exceed maxPages and never duplicate a url", async () => {
      const s = new PgCrawlStateStore(pg.client);
      const rootId = await s.createCrawl({
        id: "conc1",
        rootUrl: "https://x.test/",
        apiKeyId: 1,
        maxDepth: 2,
        maxPages: 10,
        sameDomainOnly: true,
        ignoreRobotsTxt: false,
      });
      void rootId;

      // 8 concurrent callers all attempt the SAME 5 urls. FOR UPDATE on the
      // crawl_jobs row serializes them; ON CONFLICT DO NOTHING dedups the rest.
      const batch = Array.from({ length: 5 }, (_, i) => ({
        url: `https://x.test/p${i}`,
        depth: 1,
      }));
      const results = await Promise.all(
        Array.from({ length: 8 }, () => s.insertDiscoveredPages("conc1", 10, batch)),
      );

      const allInserted = results.flat();
      const urls = allInserted.map((p) => p.url);
      // No url returned more than once across all concurrent callers.
      expect(new Set(urls).size).toBe(urls.length);
      expect(new Set(urls).size).toBe(5);
      // root + the 5 unique pages = 6, never above maxPages.
      expect((await s.getPageCounts("conc1")).total).toBe(6);
    });

    it("honors maxPages even when many concurrent callers oversubscribe", async () => {
      const s = new PgCrawlStateStore(pg.client);
      await s.createCrawl({
        id: "conc2",
        rootUrl: "https://x.test/",
        apiKeyId: 1,
        maxDepth: 2,
        maxPages: 4,
        sameDomainOnly: true,
        ignoreRobotsTxt: false,
      });
      // 10 concurrent callers, each with 6 distinct urls, but only 3 slots
      // remain (maxPages 4 - root 1).
      const batch = Array.from({ length: 6 }, (_, i) => ({
        url: `https://x.test/c${i}`,
        depth: 1,
      }));
      await Promise.all(
        Array.from({ length: 10 }, () =>
          s.insertDiscoveredPages("conc2", 4, batch),
        ),
      );
      expect((await s.getPageCounts("conc2")).total).toBe(4);
    });

    it("concurrent freshness records converge on the tighter tier (real parallelism)", async () => {
      const cache = new PgFreshnessCache(pg.client);
      const url = "https://fresh-concurrent.test";
      const crawledAt = new Date("2026-01-01T00:00:00Z");
      const content: import("@use-pith/core").ScrapeUrlResult = {
        finalUrl: url,
        title: "T",
        markdown: "x",
        text: "x",
        html: "",
        statusCode: 200,
        fetchedAt: "2026-01-01T00:00:00.000Z",
        tierUsed: "static",
        attempts: [{ tier: "static", success: true }],
      };
      await Promise.all([
        cache.record({ url, crawledAt, content, requestedTier: "standard", requestedTierMaxStalenessSeconds: 86400, requestedTierProactiveRecrawl: false }),
        cache.record({ url, crawledAt, content, requestedTier: "news", requestedTierMaxStalenessSeconds: 3600, requestedTierProactiveRecrawl: true }),
        cache.record({ url, crawledAt, content, requestedTier: "standard", requestedTierMaxStalenessSeconds: 86400, requestedTierProactiveRecrawl: false }),
      ]);
      const r = await cache.tryGet(url);
      expect(r?.watchedTier).toBe("news");
      expect(r?.watchedTierMaxStalenessSeconds).toBe(3600);
    });
  },
);
