/**
 * Tiers of work the engine prices. `Tier` lives here (not in a cost-events
 * module) because the cost-events layer is host infrastructure the OSS core
 * does not import — pricing is the canonical home for the tier union.
 */
export type Tier =
  | "static"
  | "headless"
  | "stealth"
  | "search"
  | "extraction"
  | "cache";

export type TierPriceTable = Record<Tier, number>;

/**
 * Cents charged per successful unit of work, by tier. Failed attempts are
 * never billed (handled by the cost recorder). "cache" (served with no fetch)
 * and "stealth" (not yet implemented) are free by construction. Defaults are
 * placeholder unit economics roughly in line with competitor pricing; pass a
 * custom `table` to `centsForTier` to override (the prod project passes its
 * config-derived table; the OSS has no config).
 */
export const DEFAULT_TIER_PRICE_CENTS: TierPriceTable = {
  static: 1,
  headless: 5,
  search: 2,
  extraction: 10,
  cache: 0,
  stealth: 0,
};

/**
 * Cents for a successful unit of work at `tier`. No negative/zero guard —
 * values are returned verbatim (a negative price is a misconfiguration
 * surfaced as-is, not silently clamped).
 */
export function centsForTier(
  tier: Tier,
  table: TierPriceTable = DEFAULT_TIER_PRICE_CENTS,
): number {
  return table[tier];
}

export type CentsForTier = (tier: Tier) => number;
