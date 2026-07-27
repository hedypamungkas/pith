import { describe, it, expect, vi } from "vitest";
import { pureCrawler } from "../../src/crawl/pureCrawler.js";
import { createNullPorts } from "../../src/ports/nullPorts.js";

const data = {
  crawlId: "c1",
  apiKeyId: 1,
  pageId: 1,
  url: "https://x.test/",
  depth: 0,
  maxDepth: 2,
  maxPages: 5,
  sameDomainOnly: true,
  ignoreRobotsTxt: false,
};

async function seedCrawl() {
  const ports = createNullPorts();
  await ports.crawlStateStore.createCrawl({
    id: "c1",
    rootUrl: "https://x.test/",
    apiKeyId: 1,
    maxDepth: 2,
    maxPages: 5,
    sameDomainOnly: true,
    ignoreRobotsTxt: false,
  });
  return ports;
}

describe("pureCrawler.processPage", () => {
  it("is a no-op when the page is already success (idempotency gate — no re-scrape)", async () => {
    const ports = await seedCrawl();
    await ports.crawlStateStore.markPageSuccess(1, "r-old");
    const scrapeSpy = vi.fn();
    const { processPage } = pureCrawler({
      scrape: scrapeSpy,
      stateStore: ports.crawlStateStore,
      contentStore: ports.contentStore,
    });
    const children = await processPage(data);
    expect(children).toEqual([]);
    expect(scrapeSpy).not.toHaveBeenCalled();
  });

  it("scrapes a pending page, inserts children before marking success, returns the children", async () => {
    const ports = await seedCrawl();
    const scrapeSpy = vi.fn().mockResolvedValue({
      markdown: "m",
      text: "t",
      html: `<main><a href="/child">c</a></main>`,
      title: "T",
      finalUrl: "https://x.test/",
      statusCode: 200,
      fetchedAt: "now",
      tierUsed: "static",
      attempts: [{ tier: "static", success: true }],
      budgetDegradation: undefined,
    });
    const { processPage } = pureCrawler({
      scrape: scrapeSpy,
      stateStore: ports.crawlStateStore,
      contentStore: ports.contentStore,
      snapshotStore: ports.snapshotStore,
      costRecorder: ports.costRecorder,
    });
    const children = await processPage(data);

    expect(scrapeSpy).toHaveBeenCalledWith("https://x.test/", {
      storageState: undefined,
      skipRobotsCheck: false,
    });
    expect(await ports.crawlStateStore.getPageStatus(1)).toBe("success");
    expect(children).toHaveLength(1);
    expect(children[0]!.url).toBe("https://x.test/child");
    expect(children[0]!.pageId).toBe(2);
  });

  it("marks the page failed (terminal) on ScrapeAllTiersFailedError and returns no children", async () => {
    const ports = await seedCrawl();
    const { ScrapeAllTiersFailedError } = await import("../../src/scrape/scrapeUrlCore.js");
    const scrapeSpy = vi.fn().mockRejectedValue(
      new ScrapeAllTiersFailedError("https://x.test/", [{ tier: "static", success: false }]),
    );
    const { processPage } = pureCrawler({
      scrape: scrapeSpy,
      stateStore: ports.crawlStateStore,
      contentStore: ports.contentStore,
    });
    const children = await processPage(data);
    expect(children).toEqual([]);
    expect(await ports.crawlStateStore.getPageStatus(1)).toBe("failed");
  });
});
