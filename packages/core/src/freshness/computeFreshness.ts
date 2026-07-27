import type { FreshnessTierDef } from "./freshnessTiers.js";

export interface FreshnessInfo {
  /** ISO timestamp of the crawl that produced the served content. */
  crawledAt: string;
  /** The SLA tier this freshness was checked against. */
  slaTier: string;
  /** That tier's max-staleness budget, in seconds. */
  maxStalenessSeconds: number;
  /** True iff the content's age is within the tier's budget. Staleness is
   * binary against this single threshold (`<=`) — there is no separate
   * stale-while-revalidate grace window; "serve stale" is triggered by a
   * refetch timeout/failure in composeFreshness, not by this flag. */
  withinSla: boolean;
}

/**
 * Compute the freshness of a crawl result against a tier, as of `now`. `now` is
 * injected (from the engine's `Clock` port) rather than read inline, so the
 * staleness math is testable without backdating stored rows. Verbatim logic
 * from the source's `computeFreshness` (`src/api/routes/scrape.ts:56-64`).
 */
export function computeFreshness(
  tier: FreshnessTierDef,
  crawledAt: Date,
  now: Date,
): FreshnessInfo {
  const ageSeconds = (now.getTime() - crawledAt.getTime()) / 1000;
  return {
    crawledAt: crawledAt.toISOString(),
    slaTier: tier.name,
    maxStalenessSeconds: tier.maxStalenessSeconds,
    withinSla: ageSeconds <= tier.maxStalenessSeconds,
  };
}
