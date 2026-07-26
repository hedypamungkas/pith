import type { CentsForTier, Tier } from "./pricing.js";

/**
 * A caller-specified `budget_cents` ceiling for one scrape/extract call, plus
 * whatever that call already owes regardless of fetch tier (extract's flat
 * extraction price; scrape has none, so 0). `otherCommittedCents` alone is not
 * enough to decide "can I afford tier X" — the static tier is always attempted
 * first and billed if it succeeds, so its cost must also be treated as spent
 * before asking whether headless still fits. Callers track that running total
 * themselves (see scrapeUrlCore's `spentCents`) and pass it into
 * canAffordTier/describeFetchBudgetOutcome as they go, rather than this object
 * tracking it internally.
 */
export interface FetchBudget {
  rawBudgetCents: number;
  otherCommittedCents: number;
}

/** `undefined` in, `undefined` out — callers that don't pass budget_cents get
 * exactly today's unconstrained escalation behavior. */
export function fetchBudgetFrom(
  budgetCents: number | undefined,
  otherCommittedCents = 0,
): FetchBudget | undefined {
  if (budgetCents === undefined) return undefined;
  return { rawBudgetCents: budgetCents, otherCommittedCents };
}

/** No budget specified = always affordable. `spentSoFarCents` is whatever this
 * call has already billed within scrapeUrlCore() (e.g. a static fetch that
 * already succeeded) — without it, checking "can I afford headless" against the
 * raw ceiling alone would let a call spend `otherCommittedCents + static's
 * price + headless's price`, silently exceeding a ceiling sized for just
 * `otherCommittedCents + headless's price`.
 *
 * `centsForTier` is injected so the engine's budget logic uses whatever price
 * table the engine was configured with (default = pricing.DEFAULT_TIER_PRICE_CENTS). */
export function canAffordTier(
  budget: FetchBudget | undefined,
  tier: Tier,
  centsForTier: CentsForTier,
  spentSoFarCents = 0,
): boolean {
  if (!budget) return true;
  const remaining =
    budget.rawBudgetCents - budget.otherCommittedCents - spentSoFarCents;
  return centsForTier(tier) <= remaining;
}

export interface FetchBudgetOutcome {
  applied: boolean;
  reason: string;
  budgetCents: number;
  tierServed: Tier;
  skippedTier?: Tier;
  skippedTierCostCents?: number;
}

function committedNote(budget: FetchBudget): string {
  return budget.otherCommittedCents > 0
    ? ` (${budget.otherCommittedCents} cents of which this call's fixed costs already commit)`
    : "";
}

/**
 * Turns a decision scrapeUrlCore() already made into the caller-facing note —
 * makes no decisions itself, canAffordTier() is the only place that does.
 * Always returns an outcome once a budget was specified.
 *
 * `spentSoFarCents` is the sum of every fetch-tier attempt actually billed
 * within scrapeUrlCore() (static, and headless too if it was attempted) — the
 * ceiling is compared against `otherCommittedCents + spentSoFarCents`, the true
 * total cost of this call. This also covers the combined case where escalation
 * was skipped for budget reasons *and* the served (cheaper) tier's own cost
 * still exceeds the ceiling — both facts are reported together rather than the
 * second being silently dropped whenever the first applies.
 */
export function describeFetchBudgetOutcome(
  budget: FetchBudget,
  spentSoFarCents: number,
  servedTier: Tier,
  escalationSkipped: { tier: Tier } | null,
  centsForTier: CentsForTier,
): FetchBudgetOutcome {
  const totalCostCents = budget.otherCommittedCents + spentSoFarCents;
  const exceeded = totalCostCents > budget.rawBudgetCents;

  if (escalationSkipped) {
    const skippedCost = centsForTier(escalationSkipped.tier);
    const exceededNote = exceeded
      ? ` The served ${servedTier}-tier result's own cost (${totalCostCents} cents total) also exceeds the ceiling — served anyway rather than failing.`
      : "";
    return {
      applied: true,
      tierServed: servedTier,
      skippedTier: escalationSkipped.tier,
      skippedTierCostCents: skippedCost,
      budgetCents: budget.rawBudgetCents,
      reason:
        `Escalating to ${escalationSkipped.tier} would have added ${skippedCost} cents, ` +
        `exceeding the ${budget.rawBudgetCents}-cent budget_cents ceiling` +
        `${committedNote(budget)} — served the ${servedTier}-tier result instead.${exceededNote}`,
    };
  }

  if (exceeded) {
    return {
      applied: true,
      tierServed: servedTier,
      budgetCents: budget.rawBudgetCents,
      reason:
        `budget_cents ceiling of ${budget.rawBudgetCents} cents is below this call's actual ` +
        `cost (${totalCostCents} cents)${committedNote(budget)} — served it anyway rather ` +
        `than failing the request.`,
    };
  }

  return {
    applied: false,
    tierServed: servedTier,
    budgetCents: budget.rawBudgetCents,
    reason: "Within the budget_cents ceiling; no degradation was necessary.",
  };
}
