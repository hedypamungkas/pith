import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  startCrawlTestSite,
  type CrawlTestSiteHandle,
} from "../helpers/crawlTestSite.js";

vi.mock("../../src/fetch/ssrfGuard.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/fetch/ssrfGuard.js")>();
  return { ...actual, assertPublicHost: vi.fn().mockResolvedValue(undefined) };
});

import { createEngine } from "../../src/index.js";

describe("createEngine crawl (in-process)", () => {
  let site: CrawlTestSiteHandle;

  beforeAll(async () => {
    site = await startCrawlTestSite();
  });
  afterAll(async () => {
    await site.close();
  });

  it("crawls a linked site to completion with dedup + same-domain bounds", async () => {
    const engine = createEngine();
    const handle = await engine.crawl(`${site.url}/`, {
      maxDepth: 3,
      maxPages: 20,
    });
    const status = await handle.wait();
    expect(status.status).toBe("complete");
    // root, /a, /b, /c — the off-domain link is excluded and the /c→/ cycle deduped.
    expect(status.pagesSucceeded).toBe(4);
    expect(status.pagesTotal).toBe(4);
    expect(status.pagesFailed).toBe(0);
  }, 30_000);

  it("respects maxPages", async () => {
    const engine = createEngine();
    const handle = await engine.crawl(`${site.url}/`, {
      maxDepth: 3,
      maxPages: 2,
    });
    const status = await handle.wait();
    expect(status.pagesTotal).toBe(2);
  }, 30_000);
});
