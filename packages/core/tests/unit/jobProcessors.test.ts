import { describe, it, expect, vi } from "vitest";
import { createExtractProcessor } from "../../src/ports/jobProcessors.js";
import { InProcessJobQueue } from "../../src/ports/inProcessJobQueue.js";
import { createNullPorts } from "../../src/ports/nullPorts.js";
import { NotConfiguredError } from "../../src/errors.js";
import type { ScrapeProcessor, ScrapeJobData } from "../../src/ports/corePorts.js";
import type { ScrapeUrlResult } from "../../src/scrape/scrapeUrlCore.js";
import type { ExtractionResult } from "../../src/extract/extractionPort.js";
import type { ExtractResult } from "../../src/extract/extractPure.js";
import type { CrawlPageJobData } from "../../src/crawl/types.js";

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

function fakeExtractionResult(): ExtractionResult {
  return {
    data: { name: "x" },
    confidence: { name: 0.9 },
    citations: {},
    model: "stub-model",
  };
}

describe("createExtractProcessor", () => {
  it("forwards budget + robots opt-out into the scrape processor's options (FR-7 budget gate carried through)", async () => {
    const scrapeCalls: ScrapeJobData[] = [];
    const scrape: ScrapeProcessor = async (data) => {
      scrapeCalls.push(data);
      return SCRAPE_RESULT;
    };
    const extractArgs: { schema: Record<string, unknown> }[] = [];
    const extract = vi.fn(
      async (_markdown: string, _text: string, schema: Record<string, unknown>) => {
        extractArgs.push({ schema });
        return fakeExtractionResult();
      },
    );
    // centsForTier("extraction") is reserved up front against budgetCents.
    const centsForTier = vi.fn(() => 5);

    const processExtract = createExtractProcessor({ scrape, extract, centsForTier });
    const result = await processExtract({
      url: "https://x.test/",
      schema: { type: "object", properties: { name: { type: "string" } } },
      budgetCents: 11,
      ignoreRobotsTxt: true,
    });

    expect(centsForTier).toHaveBeenCalledWith("extraction");
    expect(scrapeCalls).toHaveLength(1);
    const forwarded = scrapeCalls[0]!;
    expect(forwarded.url).toBe("https://x.test/");
    expect(forwarded.options.skipRobotsCheck).toBe(true); // ignoreRobotsTxt wired through
    expect(forwarded.options.budget).toBeDefined(); // budget reserved before the fetch-tier decision
    expect(extract).toHaveBeenCalledOnce();
    expect(extractArgs[0]?.schema).toEqual({
      type: "object",
      properties: { name: { type: "string" } },
    });
    expect(result.model).toBe("stub-model");
  });

  it("runs the scrape step inline (no queue recursion) — the scrape processor itself is the fetch step", async () => {
    // extract's fetch step is the scrape PROCESSOR (ScrapeJobData in, result
    // out), never the engine's enqueuing scrape. Here we just confirm the
    // processor is called with a ScrapeJobData payload, not re-enqueued.
    let received: ScrapeJobData | undefined;
    const scrape: ScrapeProcessor = async (data) => {
      received = data;
      return SCRAPE_RESULT;
    };
    const processExtract = createExtractProcessor({
      scrape,
      extract: vi.fn(async () => fakeExtractionResult()),
      centsForTier: () => 5,
    });
    await processExtract({ url: "https://x.test/", schema: {} });
    expect(received).toEqual({ url: "https://x.test/", options: expect.any(Object) });
  });
});

describe("InProcessJobQueue", () => {
  it("delegates each addX to the injected processor and is always sequential", async () => {
    const scrape = vi.fn(
      async (_data: ScrapeJobData): Promise<ScrapeUrlResult> => SCRAPE_RESULT,
    );
    const crawlPage = vi.fn(
      async (_data: CrawlPageJobData): Promise<CrawlPageJobData[]> => [],
    );
    const extract = vi.fn(async (): Promise<ExtractResult> => ({
      url: "https://x.test/",
      data: {},
      confidence: {},
      citations: {},
      flaggedFields: [],
      model: "stub-model",
    }));
    const queue = new InProcessJobQueue({ scrape, crawlPage, extract });

    await queue.addScrape({ url: "https://x.test/", options: {} });
    await queue.addExtract({ url: "https://x.test/", schema: {} });

    expect(scrape).toHaveBeenCalledOnce();
    expect(extract).toHaveBeenCalledOnce();
    // concurrency is intentionally absent ⇒ the drain loop treats the queue as
    // sequential (drainBatchSize(undefined) === 1).
    expect((queue as { concurrency?: number }).concurrency).toBeUndefined();
  });
});

describe("createNullPorts().queue (unconfigured placeholder)", () => {
  it("throws NotConfiguredError until createEngine wires a real queue", () => {
    const { queue } = createNullPorts();
    expect(() => queue.addScrape({ url: "u", options: {} })).toThrow(NotConfiguredError);
    expect(() => queue.addExtract({ url: "u", schema: {} })).toThrow(NotConfiguredError);
    expect(() => queue.addCrawlPage({} as CrawlPageJobData)).toThrow(NotConfiguredError);
  });
});
