import { describe, beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { Redis } from "ioredis";
import { BullMqJobQueue, runWorkers, type WorkerHandle } from "../../src/index.js";
import { redisFromEnv, type RedisHandle } from "../helpers/redis.js";
import { createNullPorts, createCrawlPageProcessor } from "@use-pith/core";
import type {
  ScrapeProcessor,
  CrawlPageProcessor,
  ExtractProcessor,
  ScrapeUrlResult,
  CrawlPageJobData,
  ExtractResult,
} from "@use-pith/core";

const SCRAPE_RESULT: ScrapeUrlResult = {
  finalUrl: "https://x.test/",
  title: "T",
  markdown: "# m",
  text: "m",
  html: "<main>m</main>",
  statusCode: 200,
  fetchedAt: "now",
  tierUsed: "static",
  attempts: [{ tier: "static", success: true }],
};

const EXTRACT_RESULT: ExtractResult = {
  url: "https://x.test/",
  data: { name: "x" },
  confidence: { name: 0.9 },
  citations: {},
  flaggedFields: [],
  model: "stub-model",
};

const noopScrape: ScrapeProcessor = async () => SCRAPE_RESULT;
const noopCrawlPage: CrawlPageProcessor = async () => [];
const noopExtract: ExtractProcessor = async () => EXTRACT_RESULT;

function crawlData(overrides: Partial<CrawlPageJobData> = {}): CrawlPageJobData {
  return {
    crawlId: "c1",
    apiKeyId: 0,
    pageId: 1,
    url: "https://x.test/",
    depth: 0,
    maxDepth: 2,
    maxPages: 50,
    sameDomainOnly: true,
    ignoreRobotsTxt: false,
    ...overrides,
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Each test gets a unique BullMQ key prefix so its producer + workers own an
// isolated keyspace — no test's worker can ever drain another's queue, even
// under graceful-close races or parallel files. (Combined with a per-file Redis
// DB in redisFromEnv, this is bulletproof isolation.)
let prefixSeq = 0;
const uniquePrefix = () => `pith-test-${process.pid}-${++prefixSeq}`;

/** Spin up a producer + workers wired to the same Redis, with default no-op
 *  processors overridable per test. Caller MUST close() the handle. */
async function harness(
  redis: RedisHandle,
  processors: {
    scrape?: ScrapeProcessor;
    crawlPage?: CrawlPageProcessor;
    extract?: ExtractProcessor;
  },
  concurrency?: number,
): Promise<{ queue: BullMqJobQueue; workers: WorkerHandle; close: () => Promise<void> }> {
  const prefix = uniquePrefix();
  const queue = new BullMqJobQueue(redis.connection, { concurrency, prefix });
  const workers = runWorkers(redis.connection, {
    scrape: processors.scrape ?? noopScrape,
    crawlPage: processors.crawlPage ?? noopCrawlPage,
    extract: processors.extract ?? noopExtract,
    concurrency,
    prefix,
  });
  await Promise.all([queue.ready(), workers.ready()]);
  return {
    queue,
    workers,
    close: () => Promise.all([workers.close(), queue.close()]).then(() => undefined),
  };
}

describe.skipIf(!process.env.REDIS_URL)("BullMqJobQueue round-trip (real Redis)", () => {
  let redis: RedisHandle;

  beforeAll(async () => {
    redis = await redisFromEnv(1);
  });
  beforeEach(async () => {
    await redis.flushdb();
  });
  afterAll(async () => {
    await redis.close();
  });

  it("addScrape enqueues → worker runs → result returns via waitUntilFinished", async () => {
    const scrape: ScrapeProcessor = async (data) => ({
      ...SCRAPE_RESULT,
      finalUrl: data.url,
    });
    const h = await harness(redis, { scrape });
    try {
      const result = await h.queue.addScrape({ url: "https://x.test/a", options: {} });
      expect(result.finalUrl).toBe("https://x.test/a");
      expect(result.markdown).toBe("# m");
    } finally {
      await h.close();
    }
  });

  it("addCrawlPage returns the discovered children the worker produced (drain-loop contract)", async () => {
    const crawlPage: CrawlPageProcessor = async (data) => [
      {
        ...data,
        pageId: data.pageId + 100,
        url: "https://x.test/child",
        depth: data.depth + 1,
      },
    ];
    const h = await harness(redis, { crawlPage });
    try {
      const children = await h.queue.addCrawlPage(
        crawlData({ pageId: 1, url: "https://x.test/parent" }),
      );
      expect(children).toHaveLength(1);
      expect(children[0]?.url).toBe("https://x.test/child");
      expect(children[0]?.depth).toBe(1);
      expect(children[0]?.pageId).toBe(101);
    } finally {
      await h.close();
    }
  });

  it("addExtract returns the worker's ExtractResult", async () => {
    const extract: ExtractProcessor = async (data) => ({
      ...EXTRACT_RESULT,
      url: data.url,
    });
    const h = await harness(redis, { extract });
    try {
      const result = await h.queue.addExtract({
        url: "https://x.test/b",
        schema: { type: "object" },
      });
      expect(result.url).toBe("https://x.test/b");
      expect(result.model).toBe("stub-model");
    } finally {
      await h.close();
    }
  });

  it("propagates a processor failure (addX rejects when the worker throws)", async () => {
    const crawlPage: CrawlPageProcessor = async () => {
      throw new Error("boom-from-worker");
    };
    const h = await harness(redis, { crawlPage });
    try {
      await expect(h.queue.addCrawlPage(crawlData())).rejects.toThrow("boom-from-worker");
    } finally {
      await h.close();
    }
  });

  it("honors worker concurrency — no more than N jobs in flight at once", async () => {
    const concurrency = 3;
    let inFlight = 0;
    let peak = 0;
    const crawlPage: CrawlPageProcessor = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await delay(80);
      inFlight -= 1;
      return [];
    };
    const h = await harness(redis, { crawlPage }, concurrency);
    try {
      await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          h.queue.addCrawlPage(crawlData({ pageId: i + 1 })),
        ),
      );
      // Parallelism happened, but never exceeded the worker concurrency.
      expect(peak).toBeGreaterThanOrEqual(2);
      expect(peak).toBeLessThanOrEqual(concurrency);
      // The producer exposes the configured width for the engine's drain loop.
      expect(h.queue.concurrency).toBe(concurrency);
    } finally {
      await h.close();
    }
  });

  it("exposes no concurrency by default (the drain loop then treats it as 1)", async () => {
    const h = await harness(redis, {});
    try {
      expect(h.queue.concurrency).toBeUndefined();
    } finally {
      await h.close();
    }
  });

  it("clamps an invalid worker concurrency (0) instead of letting BullMQ reject it", async () => {
    const prefix = uniquePrefix();
    const queue = new BullMqJobQueue(redis.connection, { prefix });
    const workers: WorkerHandle = runWorkers(redis.connection, {
      scrape: noopScrape,
      crawlPage: noopCrawlPage,
      extract: noopExtract,
      concurrency: 0,
      prefix,
    });
    await Promise.all([queue.ready(), workers.ready()]);
    try {
      const result = await queue.addScrape({ url: "https://x.test/", options: {} });
      expect(result.markdown).toBe("# m"); // worker ran (concurrency clamped to 1)
    } finally {
      await workers.close();
      await queue.close();
    }
  });

  it("a redelivered finalized crawl-page job is a no-op (no second scrape, no second bill)", async () => {
    // Uses the REAL createCrawlPageProcessor + an in-memory CrawlStateStore, so
    // the getPageStatus idempotency gate runs against genuine state.
    const base = createNullPorts();
    let scrapeCalls = 0;
    const processCrawlPage = createCrawlPageProcessor({
      scrape: () => {
        scrapeCalls += 1;
        return Promise.resolve(SCRAPE_RESULT);
      },
      stateStore: base.crawlStateStore,
      contentStore: base.contentStore,
    });
    const h = await harness(redis, { crawlPage: processCrawlPage });
    try {
      const pageId = await base.crawlStateStore.createCrawl({
        id: "c-redeliver",
        rootUrl: "https://x.test/",
        apiKeyId: 0,
        maxDepth: 1,
        maxPages: 10,
        sameDomainOnly: true,
        ignoreRobotsTxt: false,
      });
      const job = crawlData({
        crawlId: "c-redeliver",
        pageId,
        url: "https://x.test/",
        depth: 0,
        maxDepth: 1,
      });
      const first = await h.queue.addCrawlPage(job);
      const second = await h.queue.addCrawlPage(job); // the redelivery

      expect(scrapeCalls).toBe(1); // scraped exactly once across both deliveries
      expect(first).toEqual([]); // stub scrape returns no links
      expect(second).toEqual([]); // redelivery of a finalized page is a no-op
      expect(await base.crawlStateStore.getPageStatus(pageId)).toBe("success");
    } finally {
      await h.close();
    }
  });

  it("flattens a typed worker error to its message on the producer side (class/code are lost)", async () => {
    class RobotsDisallowedError extends Error {
      readonly code = "ROBOTS_DISALLOWED";
      constructor() {
        super("robots disallows https://x.test/");
        this.name = "RobotsDisallowedError";
      }
    }
    const crawlPage: CrawlPageProcessor = async () => {
      throw new RobotsDisallowedError();
    };
    const h = await harness(redis, { crawlPage });
    try {
      let caught: unknown;
      try {
        await h.queue.addCrawlPage(crawlData());
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(RobotsDisallowedError); // class lost across the wire
      expect((caught as Error).message).toBe("robots disallows https://x.test/"); // message survives
    } finally {
      await h.close();
    }
  });

  it("close(force=true) force-stops the workers", async () => {
    const prefix = uniquePrefix();
    const queue = new BullMqJobQueue(redis.connection, { prefix });
    const workers: WorkerHandle = runWorkers(redis.connection, {
      scrape: noopScrape,
      crawlPage: noopCrawlPage,
      extract: noopExtract,
      prefix,
    });
    await Promise.all([queue.ready(), workers.ready()]);
    await expect(workers.close(true)).resolves.toBeUndefined();
    await queue.close();
  });

  it("rejects a host ioredis instance missing maxRetriesPerRequest:null (clear error, not a cryptic BullMQ throw)", async () => {
    // A real instance built WITHOUT maxRetriesPerRequest:null (defaults to 20) —
    // the adapter guard must reject it up front with an actionable message.
    const misconfigured = new Redis({
      host: redis.connection.host,
      port: redis.connection.port,
    });
    try {
      expect(() => new BullMqJobQueue(misconfigured)).toThrow(
        /maxRetriesPerRequest.*null/,
      );
    } finally {
      misconfigured.disconnect();
    }
  });
});
