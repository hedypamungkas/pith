import { assertAllowedScheme, assertPublicHost } from "./ssrfGuard.js";
import { USER_AGENT } from "./userAgent.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

export interface StaticFetchResult {
  url: string;
  finalUrl: string;
  statusCode: number;
  html: string;
  fetchedAt: string;
}

export class StaticFetchError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StaticFetchError";
  }
}

/** Reads and discards a response body so its socket is released back to the pool. */
async function drain(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // best-effort — nothing more we can do if the underlying stream is already gone
  }
}

async function validateDestination(url: URL): Promise<void> {
  assertAllowedScheme(url);
  await assertPublicHost(url.hostname);
}

/**
 * Tier 1 of the fetch escalation: a plain HTTP GET, no JS execution. Handles
 * the majority of the static web at a fraction of the cost of a headless browser.
 *
 * Redirects are followed manually (not via fetch's `redirect: "follow"`) so
 * every hop's destination is re-validated against the SSRF guard — the final
 * destination of a redirect chain can differ from the URL a caller originally
 * supplied.
 */
export async function fetchStatic(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<StaticFetchResult> {
  let currentUrl: URL;
  try {
    currentUrl = new URL(url);
  } catch {
    throw new StaticFetchError(`Invalid URL: ${url}`, url);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let redirectCount = 0; ; redirectCount++) {
      await validateDestination(currentUrl);

      const response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
        },
      });

      const isRedirect = response.status >= 300 && response.status < 400;
      if (isRedirect) {
        await drain(response);

        const location = response.headers.get("location");
        if (!location) {
          throw new StaticFetchError(
            `Redirect response (${response.status}) missing Location header`,
            url,
          );
        }
        if (redirectCount >= MAX_REDIRECTS) {
          throw new StaticFetchError(`Too many redirects (>${MAX_REDIRECTS})`, url);
        }

        currentUrl = new URL(location, currentUrl);
        continue;
      }

      if (!response.ok) {
        await drain(response);
        throw new StaticFetchError(
          `Static fetch failed with status ${response.status}`,
          url,
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("html") && !contentType.includes("xml")) {
        await drain(response);
        throw new StaticFetchError(
          `Unsupported content-type for static tier: ${contentType || "unknown"}`,
          url,
        );
      }

      const html = await response.text();
      return {
        url,
        finalUrl: response.url || currentUrl.toString(),
        statusCode: response.status,
        html,
        fetchedAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    if (err instanceof StaticFetchError) throw err;
    throw new StaticFetchError(
      err instanceof Error ? err.message : "Unknown static fetch error",
      url,
      err,
    );
  } finally {
    clearTimeout(timeout);
  }
}
