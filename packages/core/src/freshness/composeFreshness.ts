import type {
  ScrapeUrlResult,
  ScrapeUrlOptions,
} from "../scrape/scrapeUrlCore.js";
import type { Clock, FreshnessCache } from "../ports/corePorts.js";
import { resolveTier, type FreshnessTierCatalog } from "./freshnessTiers.js";
import { computeFreshness, type FreshnessInfo } from "./computeFreshness.js";

/** A scrape result augmented with the freshness verdict + provenance. The
 * underlying `ScrapeUrlResult` is preserved in full — a cache hit replays the
 * same shape a fresh fetch would have returned. */
export interface FreshnessScrapeResult extends ScrapeUrlResult {
  freshness: FreshnessInfo;
  /** `true` when the content came from the cache (fresh hit or stale fallback),
   * `false` when it came from a fetch performed during this call. The source
 * infers this from `freshness.crawledAt` being old; OSS surfaces it explicitly. */
  fromCache: boolean;
}

export interface ComposeFreshnessDeps {
  cache: FreshnessCache;
  tierCatalog: FreshnessTierCatalog;
  clock: Clock;
  /** When a STALE cache row exists, the refetch is raced against this timeout
   * (ms); on timeout or fetch failure the stale content is served while the
   * in-flight fetch keeps running and updates the cache for next time. Default
   * 15000 (mirrors the source's `FRESHNESS_RECRAWL_TIMEOUT_MS`). Ignored when
   * there is no stale row to fall back to — then the fetch is awaited in full. */
  recrawlTimeoutMs?: number;
}

const DEFAULT_RECRAWL_TIMEOUT_MS = 15_000;

/**
 * Wrap a scrape with stale-while-revalidate caching. Extracted from the
 * source's inlined `handleScrapeRequest` (`src/api/routes/scrape.ts:132-166`):
 *
 *   1. Fresh hit  → serve the cached result with no fetch at all.
 *   2. Miss       → fetch, write back, serve fresh.
 *   3. Stale row  → race the refetch against `recrawlTimeoutMs`; on timeout or
 *                   failure serve the stale content (`withinSla:false`) while
 *                   the fetch resolves in the background and records.
 *
 * Opt-in: only invoked when the caller sets `opts.freshnessTier` (the engine
 * gate). The watched tier tightens monotonically inside the cache adapter (see
 * `InMemoryFreshnessCache.record` / the source's tightening upsert) — this
 * wrapper just records, it does not tighten.
 */
export function composeFreshness(
  scrape: (url: string, opts?: ScrapeUrlOptions) => Promise<ScrapeUrlResult>,
  deps: ComposeFreshnessDeps,
): (url: string, opts?: ScrapeUrlOptions) => Promise<FreshnessScrapeResult> {
  const { cache, tierCatalog, clock } = deps;
  const recrawlTimeoutMs = deps.recrawlTimeoutMs ?? DEFAULT_RECRAWL_TIMEOUT_MS;

  return async (url, opts = {}) => {
    const tier = resolveTier(tierCatalog, (opts.freshnessTier as string | undefined) ?? "standard");
    // scrapeUrlCore ignores freshnessTier, but strip it before delegating so the
    // underlying scrape sees exactly the options it understands.
    const { freshnessTier: _omit, ...scrapeOpts } = opts;
    void _omit;

    const cached = await cache.tryGet(url);

    // (1) Fresh hit — no fetch.
    if (cached && computeFreshness(tier, cached.crawledAt, clock()).withinSla) {
      return {
        ...cached.content,
        freshness: computeFreshness(tier, cached.crawledAt, clock()),
        fromCache: true,
      };
    }

    // Fetch + write back. Never lets a cache-write failure break a successful
    // scrape (parity with the source's best-effort write-back).
    const fetchAndRecord = async (): Promise<ScrapeUrlResult> => {
      const result = await scrape(url, scrapeOpts);
      try {
        await cache.record({
          url,
          requestedTier: tier.name,
          requestedTierMaxStalenessSeconds: tier.maxStalenessSeconds,
          requestedTierProactiveRecrawl: tier.proactiveRecrawl,
          crawledAt: new Date(result.fetchedAt),
          content: result,
        });
      } catch {
        /* cache write must never break a successful scrape */
      }
      return result;
    };

    // (2) Miss — nothing to fall back to; wait for the fetch in full.
    if (!cached) {
      const result = await fetchAndRecord();
      return {
        ...result,
        freshness: computeFreshness(tier, new Date(result.fetchedAt), clock()),
        fromCache: false,
      };
    }

    // (3) Stale row — race the refetch against the recrawl timeout. The fetch
    // is intentionally NOT cancelled: its resolution still writes back to the
    // cache for next time (the "revalidate" half of stale-while-revalidate).
    const refreshed = fetchAndRecord();
    try {
      const result = await raceWithTimeout(refreshed, recrawlTimeoutMs);
      return {
        ...result,
        freshness: computeFreshness(tier, new Date(result.fetchedAt), clock()),
        fromCache: false,
      };
    } catch {
      // Swallow the background fetch's rejection so it never becomes an
      // unhandled promise; the cache write inside it is already best-effort.
      void refreshed.catch(() => {});
      return {
        ...cached.content,
        // withinSla is false here by construction (we only reach case 3 when the
        // cached row is stale for this tier).
        freshness: computeFreshness(tier, cached.crawledAt, clock()),
        fromCache: true,
      };
    }
  };
}

/** Resolve `promise` or reject after `timeoutMs`, whichever comes first. The
 * underlying promise is NOT cancelled — see composeFreshness case (3). */
function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("freshness recrawl timed out")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
