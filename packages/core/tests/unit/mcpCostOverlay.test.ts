import { describe, expect, it } from "vitest";
import { callTool } from "../../src/mcp/index.js";
import type { Engine } from "../../src/engine.js";
import type { ScrapeUrlResult } from "../../src/scrape/scrapeUrlCore.js";

const URL = "https://x.test";

function makeScrapeResult(): ScrapeUrlResult {
  return {
    finalUrl: URL,
    title: "T",
    markdown: "# Hi",
    text: "Hi",
    html: "",
    statusCode: 200,
    fetchedAt: "2026-01-01T00:00:00.000Z",
    tierUsed: "static",
    attempts: [{ tier: "static", success: true }],
  };
}

/** A minimal engine whose scrape/crawl need no network — enough for the handler
 *  layer to produce a real (requestId-bearing) tool result the overlay can enrich. */
function stubEngine(scrape: () => Promise<ScrapeUrlResult> = async () => makeScrapeResult()): Engine {
  return {
    scrape: async () => scrape(),
    crawl: async () => ({ crawlId: "c1", wait: async () => ({}) }),
  } as unknown as Engine;
}

describe("callTool cost overlay", () => {
  it("enriches a successful scrape with cost_cents + budget_remaining_cents", async () => {
    const r = await callTool("scrape", { url: URL }, stubEngine(), {
      getCostCentsForRequest: async () => 42,
      getSpendCents: async () => 10,
      spendCapCents: 100,
    });
    expect(r.isError).toBeFalsy();
    const payload = r.structuredContent as Record<string, unknown>;
    expect(payload.requestId).toBeTruthy();
    expect(payload.cost_cents).toBe(42);
    expect(payload.budget_remaining_cents).toBe(90);
  });

  it("uncapped (spendCapCents:null) -> budget_remaining_cents:null", async () => {
    const r = await callTool("scrape", { url: URL }, stubEngine(), {
      getCostCentsForRequest: async () => 42,
      getSpendCents: async () => 9999,
      spendCapCents: null,
    });
    expect(
      (r.structuredContent as Record<string, unknown>).budget_remaining_cents,
    ).toBeNull();
  });

  it("clamps budget_remaining_cents at 0 when spend exceeds the cap", async () => {
    const r = await callTool("scrape", { url: URL }, stubEngine(), {
      getCostCentsForRequest: async () => 42,
      getSpendCents: async () => 150,
      spendCapCents: 100,
    });
    expect(
      (r.structuredContent as Record<string, unknown>).budget_remaining_cents,
    ).toBe(0);
  });

  it("crawl (no requestId) -> cost_cents:0; budget still reflects spend", async () => {
    const r = await callTool("crawl", { url: URL, maxPages: 1 }, stubEngine(), {
      getCostCentsForRequest: async () => 999,
      getSpendCents: async () => 30,
      spendCapCents: 100,
    });
    const payload = r.structuredContent as Record<string, unknown>;
    expect(payload.requestId).toBeUndefined();
    expect(payload.cost_cents).toBe(0);
    expect(payload.budget_remaining_cents).toBe(70);
  });

  it("omitting getCostCentsForRequest -> cost_cents:0 even with a requestId", async () => {
    const r = await callTool("scrape", { url: URL }, stubEngine(), {
      getSpendCents: async () => 5,
      spendCapCents: 100,
    });
    expect((r.structuredContent as Record<string, unknown>).cost_cents).toBe(0);
  });

  it("no overlay -> response carries no cost fields (the key-free default)", async () => {
    const r = await callTool("scrape", { url: URL }, stubEngine());
    const payload = r.structuredContent as Record<string, unknown>;
    expect("cost_cents" in payload).toBe(false);
    expect("budget_remaining_cents" in payload).toBe(false);
  });

  it("overlay is not applied to error results", async () => {
    const engine = stubEngine(async () => {
      throw new Error("upstream blew up");
    });
    const r = await callTool("scrape", { url: URL }, engine, {
      getCostCentsForRequest: async () => 42,
    });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/upstream blew up/);
  });
});
