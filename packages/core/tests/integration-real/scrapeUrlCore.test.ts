import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  startJsRenderTestServer,
  startTestHtmlServer,
  JS_RENDERED_TEXT,
  type TestServerHandle,
} from "../helpers/testServer.js";
import { fetchBudgetFrom } from "../../src/fetchBudget.js";

// Real loopback + real Chromium — the SSRF host check has its own unit tests.
vi.mock("../../src/fetch/ssrfGuard.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/fetch/ssrfGuard.js")>();
  return { ...actual, assertPublicHost: vi.fn().mockResolvedValue(undefined) };
});

import { scrapeUrlCore } from "../../src/scrape/scrapeUrlCore.js";
import { launchBrowser, closeBrowser } from "../../src/fetch/headlessFetcher.js";

describe("scrapeUrlCore (tier escalation + budget)", () => {
  let jsServer: TestServerHandle;
  let htmlServer: TestServerHandle;

  beforeAll(async () => {
    await launchBrowser();
    jsServer = await startJsRenderTestServer();
    htmlServer = await startTestHtmlServer();
  }, 60_000);

  afterAll(async () => {
    await jsServer.close();
    await htmlServer.close();
    await closeBrowser();
  });

  it("escalates to headless when the static result is too thin", async () => {
    const result = await scrapeUrlCore(jsServer.url);
    expect(result.tierUsed).toBe("headless");
    expect(result.markdown).toContain(JS_RENDERED_TEXT);
    expect(result.attempts).toEqual([
      { tier: "static", success: true },
      { tier: "headless", success: true },
    ]);
  }, 30_000);

  it("stays on the static tier when content is already substantial", async () => {
    const result = await scrapeUrlCore(htmlServer.url);
    expect(result.tierUsed).toBe("static");
    expect(result.attempts).toEqual([{ tier: "static", success: true }]);
  });

  it("skips the headless escalation when the budget can't afford it", async () => {
    const result = await scrapeUrlCore(jsServer.url, { budget: fetchBudgetFrom(1) });
    expect(result.tierUsed).toBe("static");
    expect(result.attempts).toEqual([{ tier: "static", success: true }]);
    expect(result.budgetDegradation).toEqual({
      applied: true,
      tierServed: "static",
      skippedTier: "headless",
      skippedTierCostCents: 5,
      budgetCents: 1,
      reason: expect.any(String),
    });
  });

  it("still escalates to headless when the budget covers it", async () => {
    const result = await scrapeUrlCore(jsServer.url, { budget: fetchBudgetFrom(100) });
    expect(result.tierUsed).toBe("headless");
    expect(result.budgetDegradation?.applied).toBe(false);
  }, 30_000);

  it("serves static and notes ceiling-exceeded when budget_cents is below the cheapest tier", async () => {
    // Use the substantial page so static wins on quality (no escalation) — then
    // the only budget signal is "ceiling exceeded, served anyway," with no skippedTier.
    const result = await scrapeUrlCore(htmlServer.url, { budget: fetchBudgetFrom(0) });
    expect(result.tierUsed).toBe("static");
    expect(result.budgetDegradation?.applied).toBe(true);
    expect(result.budgetDegradation?.tierServed).toBe("static");
    expect(result.budgetDegradation?.budgetCents).toBe(0);
    expect(result.budgetDegradation?.skippedTier).toBeUndefined();
  });

  it("omits budgetDegradation entirely when no budget was supplied", async () => {
    const result = await scrapeUrlCore(htmlServer.url);
    expect(result.budgetDegradation).toBeUndefined();
  });

  it("spentCents regression: already-billed static means headless no longer fits a 5-cent budget", async () => {
    // budget 5 = exactly headless's own price, but static (1c) is always billed
    // first -> affording headless would spend 1+5=6 against a 5c ceiling.
    const result = await scrapeUrlCore(jsServer.url, { budget: fetchBudgetFrom(5) });
    expect(result.tierUsed).toBe("static");
    expect(result.attempts).toEqual([{ tier: "static", success: true }]);
    expect(result.budgetDegradation?.skippedTier).toBe("headless");
    expect(result.budgetDegradation?.budgetCents).toBe(5);
  });
});
