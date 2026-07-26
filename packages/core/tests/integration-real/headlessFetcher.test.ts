import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  startJsRenderTestServer,
  startTestHtmlServer,
  JS_RENDERED_TEXT,
  type TestServerHandle,
} from "../helpers/testServer.js";

// Real HTTP servers bind to 127.0.0.1 on purpose — the SSRF host check has its
// own dedicated tests in unit/ssrfGuard.test.ts.
vi.mock("../../src/fetch/ssrfGuard.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/fetch/ssrfGuard.js")>();
  return { ...actual, assertPublicHost: vi.fn().mockResolvedValue(undefined) };
});

import {
  launchBrowser,
  closeBrowser,
  fetchHeadless,
} from "../../src/fetch/headlessFetcher.js";
import { StaticFetchError } from "../../src/fetch/staticFetcher.js";

describe("fetchHeadless", () => {
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

  it("renders client-side JS that the static tier would never see", async () => {
    const result = await fetchHeadless(jsServer.url);
    expect(result.html).toContain(JS_RENDERED_TEXT);
    expect(result.statusCode).toBe(200);
  }, 30_000);

  it("also works on a plain static page", async () => {
    const result = await fetchHeadless(htmlServer.url);
    expect(result.html).toContain("Sample Article");
  }, 30_000);

  it("throws StaticFetchError on a page that never responds", async () => {
    await expect(
      fetchHeadless("http://127.0.0.1:1/nothing-listening", 2000),
    ).rejects.toBeInstanceOf(StaticFetchError);
  }, 10_000);
});
