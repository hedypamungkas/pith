import { createRequire } from "node:module";
import { assertAllowedScheme, assertPublicHost } from "./ssrfGuard.js";
import { USER_AGENT, ROBOTS_USER_AGENT_TOKEN } from "./userAgent.js";

// robots-parser ships a CJS factory whose bundled .d.ts declares an ambient
// `declare module 'robots-parser';`, which under NodeNext makes the default
// import resolve to the module namespace rather than the callable function.
// Loading it via createRequire sidesteps the ESM-interop quirk cleanly.
const requireModule = createRequire(import.meta.url);
interface RobotsRules {
  isAllowed(url: string, ua?: string): boolean | undefined;
  isDisallowed(url: string, ua?: string): boolean | undefined;
}
const robotsParser = requireModule("robots-parser") as (
  url: string,
  robotstxt: string,
) => RobotsRules;

export class RobotsDisallowedError extends Error {
  constructor(public readonly url: string) {
    super(`Refusing to fetch ${url}: disallowed by robots.txt`);
    this.name = "RobotsDisallowedError";
  }
}

const DEFAULT_CACHE_TTL_MS = 3_600_000; // 1 hour
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

export interface RobotsResolverOptions {
  /** Per-origin robots.txt cache lifetime. Default 1 hour. */
  cacheTtlMs?: number;
  /** Max redirect hops when fetching /robots.txt. Default 5. */
  maxRedirects?: number;
  /** Injected clock (ms epoch) so tests can drive TTL expiry deterministically. */
  clock?: () => number;
}

export interface RobotsResolver {
  isAllowed(url: string): Promise<boolean>;
}

interface CacheEntry {
  robots: RobotsRules;
  fetchedAt: number;
}

/**
 * Builds a RobotsResolver. A missing, unreachable, or malformed robots.txt is
 * standard "allow all" per the robots exclusion spec — every failure mode in
 * fetchRobotsTxt (SSRF block, network error, timeout, non-2xx, too many
 * redirects) returns "" rather than throwing, and robots-parser treats empty
 * content as no rules.
 *
 * Decoupled from any config: cacheTtlMs / maxRedirects / clock are injected
 * (defaults provided), so the OSS core has no config dependency and tests can
 * drive TTL expiry via the clock.
 */
export function createRobotsResolver(
  options: RobotsResolverOptions = {},
): RobotsResolver {
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const now = options.clock ?? (() => Date.now());
  const cache = new Map<string, CacheEntry>();

  async function fetchRobotsTxt(origin: string): Promise<string> {
    let currentUrl: URL;
    try {
      currentUrl = new URL("/robots.txt", origin);
    } catch {
      return "";
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS);
    try {
      for (let redirectCount = 0; ; redirectCount++) {
        assertAllowedScheme(currentUrl);
        await assertPublicHost(currentUrl.hostname);

        const response = await fetch(currentUrl, {
          signal: controller.signal,
          redirect: "manual",
          headers: { "User-Agent": USER_AGENT },
        });

        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel().catch(() => {});
          const location = response.headers.get("location");
          if (!location || redirectCount >= maxRedirects) return "";
          currentUrl = new URL(location, currentUrl);
          continue;
        }

        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          return "";
        }

        return await response.text();
      }
    } catch {
      return "";
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getRobots(origin: string): Promise<RobotsRules> {
    const cached = cache.get(origin);
    const t = now();
    if (cached && t - cached.fetchedAt < cacheTtlMs) {
      return cached.robots;
    }
    const contents = await fetchRobotsTxt(origin);
    const robots = robotsParser(`${origin}/robots.txt`, contents);
    cache.set(origin, { robots, fetchedAt: t });
    return robots;
  }

  /**
   * One check per top-level URL — unlike the SSRF guard (which re-validates
   * every redirect hop and every headless sub-resource request), robots.txt
   * governs "should we crawl this URL at all," a decision made once against the
   * URL a caller actually asked for.
   */
  async function isAllowed(url: string): Promise<boolean> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return true;
    }
    const robots = await getRobots(parsed.origin);
    // robots-parser returns undefined when a rule can't be determined —
    // fail open, the same posture as a missing/unreachable robots.txt.
    return robots.isAllowed(url, ROBOTS_USER_AGENT_TOKEN) !== false;
  }

  return { isAllowed };
}
