import { describe, beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import {
  createEngine,
  createNullPorts,
  createScrapeProcessor,
  createCrawlPageProcessor,
  centsForTier,
  type ScrapeUrlResult,
} from "@use-pith/core";
import { BullMqJobQueue, runWorkers, type WorkerHandle } from "../../src/index.js";
import { redisFromEnv, type RedisHandle } from "../helpers/redis.js";

/**
 * End-to-end: `createEngine({ queue: new BullMqJobQueue(...) })` drives a crawl
 * whose page jobs run on Redis workers — the headline use case (parallel,
 * distributed crawl). The worker runs the REAL `createCrawlPageProcessor` state
 * machine (idempotency gate → markCrawlRunning → insert-children-before-success
 * → finalize) over the SAME in-memory CrawlStateStore the engine reads; only the
 * fetch is stubbed (so no HTTP server / SSRF mock is needed — the queue seam and
 * crawl state machine are what's under test here, not the fetch).
 */
function stubScrape(url: string): Promise<ScrapeUrlResult> {
  // Root links to /a and /b; leaves link nowhere. Enough `text` that nothing is thin.
  const links = url === "https://x.test/" ? ["/a", "/b"] : [];
  const html = `<main><p>${"x".repeat(250)}</p>${links
    .map((h) => `<a href="${h}">${h}</a>`)
    .join("")}</main>`;
  return Promise.resolve({
    finalUrl: url,
    title: "T",
    markdown: "# m",
    text: html,
    html,
    statusCode: 200,
    fetchedAt: "now",
    tierUsed: "static",
    attempts: [{ tier: "static", success: true }],
  });
}

describe.skipIf(!process.env.REDIS_URL)(
  "engine + BullMqJobQueue crawl E2E (real Redis)",
  () => {
    let redis: RedisHandle;

    beforeAll(async () => {
      redis = await redisFromEnv();
    });
    beforeEach(async () => {
      await redis.flushdb();
    });
    afterAll(async () => {
      await redis.close();
    });

    it("crawls a 3-page graph through Redis workers to a terminal status", async () => {
      const base = createNullPorts();
      const processCrawlPage = createCrawlPageProcessor({
        scrape: stubScrape,
        stateStore: base.crawlStateStore,
        contentStore: base.contentStore,
        costRecorder: base.costRecorder,
      });
      const concurrency = 2;
      const queue = new BullMqJobQueue(redis.connection, { concurrency });
      const workers: WorkerHandle = runWorkers(redis.connection, {
        scrape: createScrapeProcessor({
          centsForTier,
          robotsResolver: base.robotsResolver,
          costRecorder: base.costRecorder,
        }),
        crawlPage: processCrawlPage,
        extract: async () => {
          throw new Error("extract not used in this crawl E2E");
        },
        concurrency,
      });
      try {
        const engine = createEngine({
          crawlStateStore: base.crawlStateStore,
          contentStore: base.contentStore,
          snapshotStore: base.snapshotStore,
          costRecorder: base.costRecorder,
          robotsResolver: base.robotsResolver,
          queue,
        });
        const handle = await engine.crawl("https://x.test/", {
          maxDepth: 1,
          maxPages: 10,
          sameDomainOnly: true,
          ignoreRobotsTxt: false,
        });
        const status = await handle.wait();
        expect(status.status).toBe("complete");
        expect(status.pagesTotal).toBe(3); // root + /a + /b
        expect(status.pagesSucceeded).toBe(3);
        expect(status.pagesFailed).toBe(0);
      } finally {
        await workers.close();
        await queue.close();
      }
    });
  },
);
