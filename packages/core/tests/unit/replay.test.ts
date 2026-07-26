import { describe, expect, it, vi } from "vitest";
import { replayRequest } from "../../src/inspection/replay.js";
import { centsForTier } from "../../src/pricing.js";
import type { RequestSnapshot } from "../../src/inspection/snapshotTypes.js";

const scrapeMock = vi.fn();
const extractMock = vi.fn();

const deps = {
  scrape: (...args: unknown[]) => scrapeMock(...args),
  extract: (...args: unknown[]) => extractMock(...args),
  centsForTier,
};

function snapshot(overrides: Partial<RequestSnapshot>): RequestSnapshot {
  return {
    requestId: "r1",
    apiKeyId: 1,
    operation: "scrape",
    url: "https://example.com/page",
    input: { ignoreRobotsTxt: true },
    tierUsed: "static",
    statusCode: 200,
    finalUrl: "https://example.com/page",
    fetchedAt: "2026-01-01T00:00:00Z",
    attempts: [],
    objectKey: "request-snapshots/r1.json",
    extractionResult: null,
    createdAt: new Date(),
    ...overrides,
  };
}

const matchingScrape = {
  finalUrl: "https://example.com/page",
  statusCode: 200,
  tierUsed: "static",
  fetchedAt: "2026-02-02T00:00:00Z",
  html: "SAME-HTML",
  markdown: "md",
  text: "t",
};

describe("replayRequest (reproduce or explain, never silently differ)", () => {
  it("reports reproduced when the refetched page matches the snapshot", async () => {
    scrapeMock.mockResolvedValue(matchingScrape);
    const result = await replayRequest(
      snapshot({}),
      { markdown: "md", text: "t", html: "SAME-HTML", title: null },
      deps,
    );
    expect(result.operation).toBe("scrape");
    expect(result.reproduced).toBe(true);
    expect(result.differences).toEqual([]);
  });

  it("reports 'source page content changed' when html differs", async () => {
    scrapeMock.mockResolvedValue({ ...matchingScrape, html: "NEW-HTML" });
    const result = await replayRequest(
      snapshot({}),
      { markdown: "md", text: "t", html: "OLD-HTML", title: null },
      deps,
    );
    expect(result.reproduced).toBe(false);
    expect(result.differences).toContain("source page content changed (html differs)");
  });

  it("reports statusCode / finalUrl / tierUsed changes as differences", async () => {
    scrapeMock.mockResolvedValue({
      ...matchingScrape,
      finalUrl: "https://example.com/redirected",
      statusCode: 301,
      tierUsed: "headless",
    });
    const result = await replayRequest(
      snapshot({}),
      { markdown: "md", text: "t", html: "SAME-HTML", title: null },
      deps,
    );
    expect(result.reproduced).toBe(false);
    expect(result.differences).toEqual(
      expect.arrayContaining([
        expect.stringContaining("finalUrl changed"),
        expect.stringContaining("statusCode changed"),
        expect.stringContaining("tierUsed changed"),
      ]),
    );
  });

  it("extract replay surfaces LLM non-determinism rather than silently differing", async () => {
    scrapeMock.mockResolvedValue(matchingScrape);
    extractMock.mockResolvedValue({
      data: { price: 20 },
      confidence: { price: 0.9 },
      citations: {},
      model: "gpt-4o-mini",
    });
    const result = await replayRequest(
      snapshot({
        operation: "extract",
        input: { schema: { price: { type: "number" } }, ignoreRobotsTxt: true },
        extractionResult: {
          data: { price: 10 },
          confidence: { price: 0.9 },
          citations: {},
          flaggedFields: [],
          model: "gpt-4o-mini",
        },
      }),
      { markdown: "md", text: "t", html: "SAME-HTML", title: null },
      deps,
    );
    expect(result.operation).toBe("extract");
    expect(result.reproduced).toBe(false);
    expect(result.differences).toContain("extraction data differs");
    expect(result.notes).toContain("extraction_llm_nondeterministic");
  });

  it("notes a model change even when the page is unchanged", async () => {
    scrapeMock.mockResolvedValue(matchingScrape);
    extractMock.mockResolvedValue({
      data: { price: 10 },
      confidence: { price: 0.9 },
      citations: {},
      model: "gpt-4o-mini",
    });
    const result = await replayRequest(
      snapshot({
        operation: "extract",
        input: { schema: { price: { type: "number" } }, ignoreRobotsTxt: true },
        extractionResult: {
          data: { price: 10 },
          confidence: { price: 0.9 },
          citations: {},
          flaggedFields: [],
          model: "older-model",
        },
      }),
      { markdown: "md", text: "t", html: "SAME-HTML", title: null },
      deps,
    );
    expect(result.notes).toContain(
      "extraction model changed (older-model → gpt-4o-mini)",
    );
  });

  it("rejects crawl_page replay", async () => {
    await expect(
      replayRequest(
        snapshot({ operation: "crawl_page" }),
        { markdown: "md", text: "t", html: "h", title: null },
        deps,
      ),
    ).rejects.toThrow(/crawl_page/);
  });

  it("throws for an extract replay when no extract backend is wired (scrapeOnlyReplay)", async () => {
    scrapeMock.mockResolvedValue(matchingScrape);
    await expect(
      replayRequest(
        snapshot({ operation: "extract", input: { schema: {} } }),
        { markdown: "md", text: "t", html: "SAME-HTML", title: null },
        { scrape: deps.scrape, centsForTier }, // no extract
      ),
    ).rejects.toThrow(/extract backend/);
  });
});
