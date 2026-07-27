import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makePglite, type PgliteHandle } from "../helpers/pglite.js";
import { PgCrawlStateStore } from "../../src/crawlStateStore.js";

let h: PgliteHandle;
beforeEach(async () => {
  h = await makePglite();
});
afterEach(async () => {
  await h.close();
});

const bounds = {
  maxDepth: 2,
  maxPages: 5,
  sameDomainOnly: true,
  ignoreRobotsTxt: false,
};

// Contract parity with @use-pith/core's InMemoryCrawlStateStore
// (packages/core/tests/unit/crawlStateStore.test.ts). Same behaviors, real SQL
// via PGlite — no container.
describe("PgCrawlStateStore (contract parity)", () => {
  it("createCrawl returns a pending root page and a queued job", async () => {
    const s = new PgCrawlStateStore(h.client);
    const rootId = await s.createCrawl({
      id: "c1",
      rootUrl: "https://x.test/",
      apiKeyId: 1,
      ...bounds,
    });
    expect(await s.getPageStatus(rootId)).toBe("pending");
    expect((await s.getCrawlStatus("c1"))!.status).toBe("queued");
  });

  it("transitions queued→running→complete", async () => {
    const s = new PgCrawlStateStore(h.client);
    const rootId = await s.createCrawl({
      id: "c1",
      rootUrl: "https://x.test/",
      apiKeyId: 1,
      ...bounds,
    });
    await s.markCrawlRunning("c1");
    expect((await s.getCrawlStatus("c1"))!.status).toBe("running");
    await s.markPageSuccess(rootId, "r1");
    await s.finalizeCrawlIfDone("c1");
    const st = await s.getCrawlStatus("c1");
    expect(st!.status).toBe("complete");
    expect(st!.pagesSucceeded).toBe(1);
  });

  it("insertDiscoveredPages dedups by url and enforces maxPages", async () => {
    const s = new PgCrawlStateStore(h.client);
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

  it("finalize -> failed when every page failed", async () => {
    const s = new PgCrawlStateStore(h.client);
    const rootId = await s.createCrawl({
      id: "c1",
      rootUrl: "https://x.test/",
      apiKeyId: 1,
      ...bounds,
    });
    await s.markPageFailed(rootId, "r1", "boom");
    await s.finalizeCrawlIfDone("c1");
    expect((await s.getCrawlStatus("c1"))!.status).toBe("failed");
  });

  it("finalize -> partial when some succeed and some fail", async () => {
    const s = new PgCrawlStateStore(h.client);
    const rootId = await s.createCrawl({
      id: "c1",
      rootUrl: "https://x.test/",
      apiKeyId: 1,
      ...bounds,
    });
    const child = await s.insertDiscoveredPages("c1", 5, [
      { url: "https://x.test/a", depth: 1 },
    ]);
    await s.markPageSuccess(rootId, "r1");
    await s.markPageFailed(child[0]!.id, "r2", "boom");
    await s.finalizeCrawlIfDone("c1");
    expect((await s.getCrawlStatus("c1"))!.status).toBe("partial");
  });

  it("treats paused pages as outstanding (does not finalize)", async () => {
    const s = new PgCrawlStateStore(h.client);
    const rootId = await s.createCrawl({
      id: "c1",
      rootUrl: "https://x.test/",
      apiKeyId: 1,
      ...bounds,
    });
    await s.markPagePaused(rootId, "r1", "needs reauth");
    expect(await s.finalizeCrawlIfDone("c1")).toBe(false);
    expect((await s.getCrawlStatus("c1"))!.status).toBe("queued");
  });

  it("listPausedPages returns paused pages for the matching session only", async () => {
    const s = new PgCrawlStateStore(h.client);
    const rootId = await s.createCrawl({
      id: "c1",
      rootUrl: "https://x.test/",
      apiKeyId: 1,
      authSessionId: "sess1",
      ...bounds,
    });
    await s.markPagePaused(rootId, "r1", "needs reauth");
    expect(await s.listPausedPages("sess1")).toHaveLength(1);
    expect(await s.listPausedPages("other")).toHaveLength(0);
  });

  it("listPages returns page details ordered by discovery", async () => {
    const s = new PgCrawlStateStore(h.client);
    const rootId = await s.createCrawl({
      id: "c1",
      rootUrl: "https://x.test/",
      apiKeyId: 1,
      ...bounds,
    });
    await s.insertDiscoveredPages("c1", 5, [
      { url: "https://x.test/a", depth: 1 },
    ]);
    await s.markPageSuccess(rootId, "r1");
    const pages = await s.listPages("c1");
    expect(pages).toHaveLength(2);
    expect(pages[0]!.url).toBe("https://x.test/");
    expect(pages[0]!.status).toBe("success");
    expect(pages[0]!.requestId).toBe("r1");
    expect(pages[0]!.completedAt).toBeInstanceOf(Date);
  });
});
