import { describe, it, expect } from "vitest";
import {
  createEngine,
  NotConfiguredError,
  InMemoryFreshnessCache,
  type ScrapeUrlResult,
} from "../../src/index.js";

describe("createEngine wiring", () => {
  it("returns an engine with fully-populated null ports", () => {
    const engine = createEngine();
    expect(engine.ports.clock()).toBeInstanceOf(Date);
    expect(engine.ports.costRecorder.hasCostEventForRequest("req_1")).toBe(false);
    expect(engine.ports.robotsResolver.isAllowed("https://example.com")).toBe(true);
  });

  it("merges caller overrides over the null defaults", () => {
    const customNow = new Date("2026-01-01T00:00:00Z");
    const engine = createEngine({ clock: () => customNow });
    expect(engine.ports.clock()).toBe(customNow);
    // Non-overridden ports still come from createNullPorts().
    expect(engine.ports.costRecorder.hasCostEventForRequest("x")).toBe(false);
  });

  it("extract/search reject with NotConfiguredError without a backend", async () => {
    const engine = createEngine();
    await expect(
      engine.extract("https://example.com", { type: "object" }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(engine.search("query")).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("crawl returns a handle (wait() drains to completion; exercised in integration)", async () => {
    const engine = createEngine();
    const handle = await engine.crawl("https://example.com");
    expect(handle.crawlId).toBeTruthy();
    expect(typeof handle.wait).toBe("function");
  });

  it("routes scrape through the freshness cache when freshnessTier is set (cache hit -> no fetch, clock consumed)", async () => {
    const cache = new InMemoryFreshnessCache();
    const crawledAt = new Date("2026-01-01T00:00:00Z");
    await cache.record({
      url: "https://fresh.example.test",
      requestedTier: "news",
      requestedTierMaxStalenessSeconds: 3600,
      requestedTierProactiveRecrawl: true,
      crawledAt,
      content: {
        finalUrl: "https://fresh.example.test",
        title: "Cached Page",
        markdown: "# Cached",
        text: "Cached body",
        html: "",
        statusCode: 200,
        fetchedAt: crawledAt.toISOString(),
        tierUsed: "static",
        attempts: [],
      },
    });
    const engine = createEngine({
      freshnessCache: cache,
      // +30min: within the news tier's 1h SLA -> served from cache, no fetch.
      clock: () => new Date("2026-01-01T00:30:00Z"),
    });
    const result = (await engine.scrape("https://fresh.example.test", {
      freshnessTier: "news",
    })) as ScrapeUrlResult & {
      freshness: { withinSla: boolean; slaTier: string };
      fromCache: boolean;
    };
    expect(result.fromCache).toBe(true);
    expect(result.freshness.withinSla).toBe(true);
    expect(result.freshness.slaTier).toBe("news");
    expect(result.title).toBe("Cached Page");
  });
});
