import { describe, beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { BullMqJobQueue, runWorkers, type WorkerHandle } from "../../src/index.js";
import { redisFromEnv, type RedisHandle } from "../helpers/redis.js";
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
  const queue = new BullMqJobQueue(redis.connection, { concurrency });
  const workers = runWorkers(redis.connection, {
    scrape: processors.scrape ?? noopScrape,
    crawlPage: processors.crawlPage ?? noopCrawlPage,
    extract: processors.extract ?? noopExtract,
    concurrency,
  });
  return {
    queue,
    workers,
    close: () => Promise.all([workers.close(), queue.close()]).then(() => undefined),
  };
}

describe.skipIf(!process.env.REDIS_URL)("BullMqJobQueue round-trip (real Redis)", () => {
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
    } finally {
      await h.close();
    }
  });
});
