import { describe, it, expect, vi } from "vitest";
import { extractPure } from "../../src/extract/extractPure.js";
import { centsForTier } from "../../src/pricing.js";

const scrapeStub = vi.fn();
const extractStub = vi.fn();

function deps() {
  return { scrape: scrapeStub, extract: extractStub, centsForTier };
}

describe("extractPure", () => {
  it("verifies citations and flags low-confidence fields", async () => {
    scrapeStub.mockResolvedValue({
      markdown: "# T\nbody text here",
      text: "T body text here",
      finalUrl: "https://x.test",
      budgetDegradation: undefined,
    });
    extractStub.mockResolvedValue({
      data: { title: "T" },
      confidence: { title: 0.4 },
      citations: { title: { quote: "body text here", supportScore: 0.9 } },
      model: "m",
    });
    const r = await extractPure(
      { url: "https://x.test", schema: { type: "object" } },
      deps(),
    );
    expect(r.data.title).toBe("T");
    expect(r.flaggedFields).toEqual(["title"]); // confidence 0.4 < 0.7
    expect(r.citations.title?.verified).toBe(true);
  });

  it("reserves the extraction price against the budget up front (otherCommittedCents)", async () => {
    scrapeStub.mockResolvedValue({
      markdown: "m",
      text: "t",
      finalUrl: "https://x.test",
      budgetDegradation: undefined,
    });
    extractStub.mockResolvedValue({
      data: { a: 1 },
      confidence: { a: 0.9 },
      citations: {},
      model: "m",
    });
    await extractPure(
      { url: "https://x.test", schema: {}, budgetCents: 11 },
      deps(),
    );
    expect(scrapeStub).toHaveBeenCalledWith(
      "https://x.test",
      expect.objectContaining({
        budget: { rawBudgetCents: 11, otherCommittedCents: 10 },
        skipRobotsCheck: undefined,
      }),
    );
  });

  it("passes ignoreRobotsTxt through as skipRobotsCheck", async () => {
    scrapeStub.mockResolvedValue({
      markdown: "m",
      text: "t",
      finalUrl: "u",
      budgetDegradation: undefined,
    });
    extractStub.mockResolvedValue({
      data: {},
      confidence: {},
      citations: {},
      model: "m",
    });
    await extractPure({ url: "u", schema: {}, ignoreRobotsTxt: true }, deps());
    expect(scrapeStub).toHaveBeenCalledWith(
      "u",
      expect.objectContaining({ skipRobotsCheck: true }),
    );
  });

  it("carries the scrape's budgetDegradation into the result", async () => {
    scrapeStub.mockResolvedValue({
      markdown: "m",
      text: "t",
      finalUrl: "u",
      budgetDegradation: {
        applied: true,
        reason: "x",
        budgetCents: 11,
        tierServed: "static",
        skippedTier: "headless",
        skippedTierCostCents: 5,
      },
    });
    extractStub.mockResolvedValue({
      data: {},
      confidence: {},
      citations: {},
      model: "m",
    });
    const r = await extractPure(
      { url: "u", schema: {}, budgetCents: 11 },
      deps(),
    );
    expect(r.budgetDegradation?.skippedTier).toBe("headless");
  });
});
