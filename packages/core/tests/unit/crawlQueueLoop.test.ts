import { describe, it, expect, vi } from "vitest";
import {
  pureCrawler,
  createCrawlPageProcessor,
} from "../../src/crawl/pureCrawler.js";
import { createNullPorts } from "../../src/ports/nullPorts.js";
import type { JobQueue } from "../../src/ports/corePorts.js";
import type { ScrapeUrlResult } from "../../src/scrape/scrapeUrlCore.js";
import type { CrawlPageJobData } from "../../src/crawl/types.js";

/** A scrape stub that builds a tiny link graph: the root links to /a, /b, /c;
 *  leaves link nowhere. Returns enough `text` that nothing is thin (the crawler
 *  itself does no escalation — it just consumes the result). */
function fakeScrape(url: string): Promise<ScrapeUrlResult> {
  const links = url.endsWith("/") ? ["/a", "/b", "/c"] : [];
  const html = `<main><p>${"x".repeat(250)}</p>${links
    .map((h) => `<a href="${h}">${h}</a>`)
    .join("")}</main>`;
  return Promise.resolve({
    finalUrl: url,
    title: "T",
    markdown: "m",
    text: html,
    html,
    statusCode: 200,
    fetchedAt: "now",
    tierUsed: "static",
    attempts: [{ tier: "static", success: true }],
  });
}

/** An in-process queue that runs the REAL crawl-page processor inline but
 *  advertises `concurrency > 1`, so the drain loop batches its frontier — the
 *  configuration a BullMQ backend would use. */
function makeConcurrentQueue(
  processor: (data: CrawlPageJobData) => Promise<CrawlPageJobData[]>,
  concurrency: number,
): { queue: JobQueue; addCrawlPage: ReturnType<typeof vi.fn> } {
  const addCrawlPage = vi.fn((d: CrawlPageJobData) => processor(d));
  return {
    queue: {
      addScrape: vi.fn(),
      addCrawlPage,
      addExtract: vi.fn(),
      concurrency,
    },
    addCrawlPage,
  };
}

describe("pureCrawler drain loop (concurrency-parametrized queue)", () => {
  it("processes the frontier in batches (concurrency>1) and still reaches a correct terminal state", async () => {
    const ports = createNullPorts();
    const processor = createCrawlPageProcessor({
      scrape: fakeScrape,
      stateStore: ports.crawlStateStore,
      contentStore: ports.contentStore,
    });
    const { queue, addCrawlPage } = makeConcurrentQueue(processor, 4);
    const { crawl } = pureCrawler({
      scrape: fakeScrape,
      stateStore: ports.crawlStateStore,
      contentStore: ports.contentStore,
      queue,
    });

    const handle = await crawl("https://x.test/", {
      maxDepth: 2,
      maxPages: 10,
      sameDomainOnly: true,
      ignoreRobotsTxt: false,
    });
    const status = await handle.wait();

    // root + /a + /b + /c = 4 pages, all succeeded; the concurrent batch didn't
    // double-count or lose a page (serialized insertDiscoveredPages + finalize).
    expect(status.status).toBe("complete");
    expect(status.pagesTotal).toBe(4);
    expect(status.pagesSucceeded).toBe(4);
    expect(status.pagesFailed).toBe(0);
    // Every page went through the queue (not an inline bypass).
    expect(addCrawlPage).toHaveBeenCalledTimes(4);
  });

  it("with concurrency 1 the drain is sequential (parity with the original in-process crawl)", async () => {
    const ports = createNullPorts();
    const processor = createCrawlPageProcessor({
      scrape: fakeScrape,
      stateStore: ports.crawlStateStore,
      contentStore: ports.contentStore,
    });
    const { queue } = makeConcurrentQueue(processor, 1);
    const { crawl } = pureCrawler({
      scrape: fakeScrape,
      stateStore: ports.crawlStateStore,
      contentStore: ports.contentStore,
      queue,
    });
    const status = await (await crawl("https://x.test/", {
      maxDepth: 2,
      maxPages: 10,
      sameDomainOnly: true,
      ignoreRobotsTxt: false,
    })).wait();
    expect(status.pagesTotal).toBe(4);
    expect(status.status).toBe("complete");
  });
});
