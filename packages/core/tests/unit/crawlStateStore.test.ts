import { describe, it, expect } from "vitest";
import { createNullPorts } from "../../src/ports/nullPorts.js";

function freshStore() {
  return createNullPorts().crawlStateStore;
}

const bounds = {
  maxDepth: 2,
  maxPages: 5,
  sameDomainOnly: true,
  ignoreRobotsTxt: false,
};

describe("InMemoryCrawlStateStore", () => {
  it("createCrawl returns the root page id and a pending root page", async () => {
    const s = freshStore();
    const rootId = await s.createCrawl({
      id: "c1",
      rootUrl: "https://x.test/",
      apiKeyId: 1,
      ...bounds,
    });
    expect(rootId).toBe(1);
    expect(await s.getPageStatus(1)).toBe("pending");
    expect((await s.getCrawlStatus("c1"))!.status).toBe("queued");
  });

  it("transitions queued→running→complete", async () => {
    const s = freshStore();
    await s.createCrawl({ id: "c1", rootUrl: "https://x.test/", apiKeyId: 1, ...bounds });
    await s.markCrawlRunning("c1");
    expect((await s.getCrawlStatus("c1"))!.status).toBe("running");
    await s.markPageSuccess(1, "r1");
    await s.finalizeCrawlIfDone("c1");
    const st = await s.getCrawlStatus("c1");
    expect(st!.status).toBe("complete");
    expect(st!.pagesSucceeded).toBe(1);
  });

  it("insertDiscoveredPages dedups by url and enforces maxPages", async () => {
    const s = freshStore();
    await s.createCrawl({
      id: "c1",
      rootUrl: "https://x.test/",
      apiKeyId: 1,
      ...bounds,
      maxPages: 3,
    });
    // root counts as 1 -> capacity for 2 more out of these 4 (one dup, one over cap)
    const inserted = await s.insertDiscoveredPages("c1", 3, [
      { url: "https://x.test/a", depth: 1 },
      { url: "https://x.test/a", depth: 1 },
      { url: "https://x.test/b", depth: 1 },
      { url: "https://x.test/c", depth: 1 },
    ]);
    expect(inserted).toHaveLength(2);
    expect((await s.getPageCounts("c1")).total).toBe(3);
  });

  it("finalize -> failed when every page failed; partial when some succeed", async () => {
    const s = freshStore();
    await s.createCrawl({ id: "c1", rootUrl: "https://x.test/", apiKeyId: 1, ...bounds });
    await s.markPageFailed(1, "r1", "boom");
    await s.finalizeCrawlIfDone("c1");
    expect((await s.getCrawlStatus("c1"))!.status).toBe("failed");

    const s2 = freshStore();
    await s2.createCrawl({ id: "c2", rootUrl: "https://x.test/", apiKeyId: 1, ...bounds });
    const child = await s2.insertDiscoveredPages("c2", 5, [
      { url: "https://x.test/a", depth: 1 },
    ]);
    await s2.markPageSuccess(1, "r1");
    await s2.markPageFailed(child[0]!.id, "r2", "boom");
    await s2.finalizeCrawlIfDone("c2");
    expect((await s2.getCrawlStatus("c2"))!.status).toBe("partial");
  });

  it("treats paused pages as outstanding (does not finalize)", async () => {
    const s = freshStore();
    await s.createCrawl({ id: "c1", rootUrl: "https://x.test/", apiKeyId: 1, ...bounds });
    await s.markPagePaused(1, "r1", "needs reauth");
    expect(await s.finalizeCrawlIfDone("c1")).toBe(false);
    expect((await s.getCrawlStatus("c1"))!.status).toBe("queued");
  });

  it("listPausedPages returns paused pages for the matching session only", async () => {
    const s = freshStore();
    await s.createCrawl({
      id: "c1",
      rootUrl: "https://x.test/",
      apiKeyId: 1,
      authSessionId: "sess1",
      ...bounds,
    });
    await s.markPagePaused(1, "r1", "needs reauth");
    expect(await s.listPausedPages("sess1")).toHaveLength(1);
    expect(await s.listPausedPages("other")).toHaveLength(0);
  });
});
