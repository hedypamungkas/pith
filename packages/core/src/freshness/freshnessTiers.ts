/**
 * Freshness tier catalog + resolution.
 *
 * The source project drives this from a `freshness_tiers` Postgres table seeded
 * with `news` (3600s, proactively re-crawled) and `standard` (86400s, refreshed
 * lazily on next request). For the OSS core — zero infrastructure by default —
 * the catalog is a plain code const (`DEFAULT_TIER_CATALOG`), overridable via
 * `createEngine({ freshnessTierCatalog })`. A prod adapter is free to back this
 * map with a table; the engine only ever reads it through `resolveTier`.
 */

export interface FreshnessTierDef {
  name: string;
  /** How many seconds a cached scrape of this tier stays "within SLA" (fresh).
   * Strictness is derived purely from this number — smaller = stricter. */
  maxStalenessSeconds: number;
  /** Whether a proactive scheduler re-crawls this tier's due URLs (like "news")
   * vs. only refreshing lazily on the next request (like "standard"). An explicit
   * opt-in per tier, not inferred from strictness. */
  proactiveRecrawl: boolean;
}

export type FreshnessTierCatalog = Record<string, FreshnessTierDef>;

/** The two tiers the source seeds, with the same values + proactive asymmetry. */
export const DEFAULT_TIER_CATALOG: FreshnessTierCatalog = {
  news: { name: "news", maxStalenessSeconds: 3600, proactiveRecrawl: true },
  standard: { name: "standard", maxStalenessSeconds: 86400, proactiveRecrawl: false },
};

/** Thrown when a requested `freshnessTier` isn't in the catalog. Intended to map
 * to a 4xx client error at the handler layer (the source returns 400 for an
 * unknown tier). */
export class UnknownFreshnessTierError extends Error {
  constructor(name: string) {
    super(`Unknown freshness tier: ${name}`);
    this.name = "UnknownFreshnessTierError";
  }
}

/** Look up a tier by name, throwing `UnknownFreshnessTierError` on a miss. The
 * returned def's `name` is normalized to the lookup key. */
export function resolveTier(
  catalog: FreshnessTierCatalog,
  name: string,
): FreshnessTierDef {
  const tier = catalog[name];
  if (!tier) throw new UnknownFreshnessTierError(name);
  return { ...tier, name };
}
