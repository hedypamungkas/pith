import { describe, it, expect, vi } from "vitest";
import { pureCrawler, createCrawlPageProcessor } from "../../src/crawl/pureCrawler.js";
import { createNullPorts } from "../../src/ports/nullPorts.js";
import type { JobQueue } from "../../src/ports/corePorts.js";
import type { ScrapeUrlResult } from "../../src/scrape/scrapeUrlCore.js";
import type { CrawlPageJobData } from "../../src/crawl/types.js";

/** A scrape stub that builds a link graph broad enough that a concurrent batch
 *  has several pages each discovering children: root `/` → /a,/b,/c; `/a` →
 *  /a/1,/a/2; `/b` → /b/1; `/c` and all leaves link nowhere. Returns enough `text`
 *  that nothing is thin (the crawler itself does no escalation — it just consumes
 *  the result). At maxDepth 2 this is a 7-page crawl. */
function fakeScrape(url: string): Promise<ScrapeUrlResult> {
  const links = url.endsWith("/")
    ? ["/a", "/b", "/c"]
    : url.endsWith("/a")
      ? ["/a/1", "/a/2"]
      : url.endsWith("/b")
        ? ["/b/1"]
        : [];
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
 *  configuration a real runner would use. */
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
  it("processes a broadening frontier in batches (concurrency>1) and still reaches a correct terminal state", async () => {
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
      maxPages: 20,
      sameDomainOnly: true,
      ignoreRobotsTxt: false,
    });
    const status = await handle.wait();

    // 7 pages (root + /a + /b + /c + /a/1 + /a/2 + /b/1), all succeeded. Batch 2
    // holds /a,/b,/c with /a and /b BOTH returning non-empty children at once —
    // so the flatten + pending.push path is exercised under real concurrency,
    // and no child is double-counted or lost (serialized insert + finalize).
    expect(status.status).toBe("complete");
    expect(status.pagesTotal).toBe(7);
    expect(status.pagesSucceeded).toBe(7);
    expect(status.pagesFailed).toBe(0);
    // Every page went through the queue exactly once (no inline bypass, no
    // duplicate enqueue of the same pageId — 7 calls for 7 distinct pages).
    expect(addCrawlPage).toHaveBeenCalledTimes(7);
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
    const status = await (
      await crawl("https://x.test/", {
        maxDepth: 2,
        maxPages: 20,
        sameDomainOnly: true,
        ignoreRobotsTxt: false,
      })
    ).wait();
    expect(status.pagesTotal).toBe(7);
    expect(status.status).toBe("complete");
  });

  it("clamps an invalid concurrency to 1 (no infinite hang on splice(0,0))", async () => {
    const ports = createNullPorts();
    const processor = createCrawlPageProcessor({
      scrape: fakeScrape,
      stateStore: ports.crawlStateStore,
      contentStore: ports.contentStore,
    });
    // concurrency 0 would make `splice(0,0)` a no-op and hang forever; the drain
    // loop must clamp it to 1.
    const { queue } = makeConcurrentQueue(processor, 0);
    const { crawl } = pureCrawler({
      scrape: fakeScrape,
      stateStore: ports.crawlStateStore,
      contentStore: ports.contentStore,
      queue,
    });
    const status = await (
      await crawl("https://x.test/", {
        maxDepth: 2,
        maxPages: 20,
        sameDomainOnly: true,
        ignoreRobotsTxt: false,
      })
    ).wait();
    expect(status.pagesTotal).toBe(7);
    expect(status.status).toBe("complete");
  });

  it("drains a whole batch before propagating failure (no orphaned sibling rejections)", async () => {
    const ports = createNullPorts();
    // Two sibling pages fail with a NON-terminal error in the same concurrent
    // batch. A bare `Promise.all` would short-circuit on the first rejection and
    // orphan the second as an unhandled rejection; `Promise.allSettled` drains
    // both, then wait() rejects exactly once.
    const flakyScrape = (url: string): Promise<ScrapeUrlResult> => {
      if (url.endsWith("/b") || url.endsWith("/c")) {
        return Promise.reject(new Error(`boom:${url}`));
      }
      return fakeScrape(url);
    };
    const processor = createCrawlPageProcessor({
      scrape: flakyScrape,
      stateStore: ports.crawlStateStore,
      contentStore: ports.contentStore,
    });
    const { queue } = makeConcurrentQueue(processor, 4);
    const { crawl } = pureCrawler({
      scrape: flakyScrape,
      stateStore: ports.crawlStateStore,
      contentStore: ports.contentStore,
      queue,
    });
    const handle = await crawl("https://x.test/", {
      maxDepth: 2,
      maxPages: 20,
      sameDomainOnly: true,
      ignoreRobotsTxt: false,
    });
    // wait() rejects with one of the two failures; the other is drained, not
    // orphaned (no unhandled rejection surfaced by the test runtime).
    await expect(handle.wait()).rejects.toThrow(/boom:/);
  });
});
