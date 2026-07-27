import type { Browser, BrowserContext } from "playwright";
import { Semaphore } from "../lib/semaphore.js";
import { assertAllowedScheme, assertPublicHost, BlockedHostError } from "./ssrfGuard.js";
import { StaticFetchError } from "./staticFetcher.js";
import type { StorageState } from "../types.js";
import { USER_AGENT } from "./userAgent.js";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_CONCURRENT_CONTEXTS = 5;

export interface HeadlessFetchResult {
  url: string;
  finalUrl: string;
  statusCode: number;
  html: string;
  fetchedAt: string;
}

let browser: Browser | null = null;
const headlessSemaphore = new Semaphore(MAX_CONCURRENT_CONTEXTS);

/** Launches the single shared browser process. Call once at worker startup. */
export async function launchBrowser(): Promise<void> {
  if (browser) return;
  // Lazy import so `@use-pith/core` itself never requires Playwright at module load
  // — a static-only consumer pays nothing for it. Only launching the browser
  // (the headless tier) pulls it in.
  const { chromium } = await import("playwright");
  browser = await chromium.launch({ headless: true });
}

export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = null;
}

/**
 * Every outgoing request from the page (navigation, redirects, XHR, images,
 * fetch calls the page's own JS makes) is checked against the SSRF guard.
 * The manual-redirect-loop check in staticFetcher.ts only covers navigation it
 * initiates itself — Playwright can navigate through redirects and issue
 * sub-resource requests the caller never sees directly, so the guard has to
 * live at the routing layer to cover all of it.
 */
async function installSsrfGuard(context: BrowserContext): Promise<void> {
  await context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    try {
      assertAllowedScheme(requestUrl);
      await assertPublicHost(requestUrl.hostname);
      await route.continue();
    } catch {
      await route.abort();
    }
  });
}

/**
 * Tier 2 of the fetch escalation: renders the page in a real browser so
 * client-side JS has run before content is extracted. Reserved for pages the
 * static tier fails on, or returns suspiciously little content from (see
 * scrapeUrlCore for the escalation decision).
 */
export async function fetchHeadless(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  storageState?: StorageState,
): Promise<HeadlessFetchResult> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new StaticFetchError(`Invalid URL: ${url}`, url);
  }

  try {
    assertAllowedScheme(target);
    await assertPublicHost(target.hostname);
  } catch (err) {
    throw new StaticFetchError((err as Error).message, url, err);
  }

  return headlessSemaphore.run(async () => {
    if (!browser) {
      throw new Error(
        "Headless browser not launched — call launchBrowser() at worker startup",
      );
    }

    const context = await browser.newContext({ userAgent: USER_AGENT, storageState });
    try {
      await installSsrfGuard(context);
      const page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);

      const response = await page.goto(url, {
        waitUntil: "networkidle",
        timeout: timeoutMs,
      });

      if (!response) {
        throw new StaticFetchError(`Headless navigation to ${url} returned no response`, url);
      }
      if (!response.ok()) {
        throw new StaticFetchError(
          `Headless fetch failed with status ${response.status()}`,
          url,
        );
      }

      const html = await page.content();
      return {
        url,
        finalUrl: page.url(),
        statusCode: response.status(),
        html,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      if (err instanceof StaticFetchError || err instanceof BlockedHostError) throw err;
      throw new StaticFetchError(
        err instanceof Error ? err.message : "Unknown headless fetch error",
        url,
        err,
      );
    } finally {
      await context.close();
    }
  });
}
