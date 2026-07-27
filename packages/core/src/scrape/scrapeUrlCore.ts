import { fetchStatic, StaticFetchError } from "../fetch/staticFetcher.js";
import { fetchHeadless } from "../fetch/headlessFetcher.js";
import { htmlToMarkdown, type ExtractedContent } from "../content/htmlToMarkdown.js";
import {
  canAffordTier,
  describeFetchBudgetOutcome,
  type FetchBudget,
  type FetchBudgetOutcome,
} from "../fetchBudget.js";
import type { StorageState } from "../types.js";
import type { Tier, ScrapeAttempt, CentsForTier } from "../pricing.js";
import { centsForTier as defaultCentsForTier } from "../pricing.js";
import type { RobotsResolver } from "../ports/corePorts.js";
import { RobotsDisallowedError } from "../fetch/robotsGuard.js";

export { RobotsDisallowedError };

/** Below this many characters of extracted text, a "successful" static fetch is
 * treated as suspiciously thin — the classic JS-rendered SPA shell. Escalating
 * to headless resolves the ambiguity; whichever tier yields more content wins. */
const MIN_CONTENT_CHARS = 200;

/** Thrown when every tier failed. Carries the attempts so the caller can still
 * record a cost event per tier that was actually tried. */
export class ScrapeAllTiersFailedError extends Error {
  constructor(
    url: string,
    public readonly attempts: ScrapeAttempt[],
  ) {
    super(`Failed to scrape ${url} on every available tier`);
    this.name = "ScrapeAllTiersFailedError";
  }
}

export interface ScrapeUrlResult {
  finalUrl: string;
  title: string | null;
  markdown: string;
  text: string;
  /** Raw HTML of whichever tier won — crawl orchestration needs this to discover
   * outbound links; single-page scrape callers can ignore it. */
  html: string;
  statusCode: number;
  fetchedAt: string;
  tierUsed: Tier;
  /** Every tier attempted, in order, with its outcome — for cost bookkeeping. */
  attempts: ScrapeAttempt[];
  /** Present only when a budget was supplied via ScrapeUrlOptions. */
  budgetDegradation?: FetchBudgetOutcome;
}

export interface ScrapeUrlOptions {
  /** FR-7 budget-ceiling — gates whether a thin-but-successful static result
   * gets escalated to headless. Never gates the case where static failed
   * outright: a budget can only decline an escalation that has a cheaper
   * fallback to decline into. */
  budget?: FetchBudget;
  /** FR-6 — when set, the headless browser context is created already logged in.
   * Presence skips the static tier entirely and is not composed with `budget`. */
  storageState?: StorageState;
  /** Per-request robots.txt compliance opt-out. */
  skipRobotsCheck?: boolean;
  /** Opt into stale-while-revalidate caching. When set, the engine routes this
   * scrape through `composeFreshness` against the configured freshness cache +
   * tier catalog; `scrapeUrlCore` itself ignores it (caching is an engine-level
   * concern). `undefined` → the zero-cache direct path. */
  freshnessTier?: string;
}

export interface ScrapeUrlDeps {
  /** Price lookup for the budget math. Defaults to pricing.centsForTier. */
  centsForTier?: CentsForTier;
  /** Robots.txt resolver. Defaults to allow-all (zero-network) — pass
   * createRobotsResolver() for real spec-compliant checks. */
  robotsResolver?: RobotsResolver;
}

const ALLOW_ALL_ROBOTS: RobotsResolver = { isAllowed: () => true };

interface TierOutcome {
  extracted: ExtractedContent;
  html: string;
  statusCode: number;
  fetchedAt: string;
  finalUrl: string;
}

function toScrapeResult(
  outcome: TierOutcome,
  tierUsed: Tier,
  attempts: ScrapeAttempt[],
  budgetDegradation?: FetchBudgetOutcome,
): ScrapeUrlResult {
  return {
    finalUrl: outcome.finalUrl,
    title: outcome.extracted.title,
    markdown: outcome.extracted.markdown,
    text: outcome.extracted.text,
    html: outcome.html,
    statusCode: outcome.statusCode,
    fetchedAt: outcome.fetchedAt,
    tierUsed,
    attempts,
    budgetDegradation,
  };
}

async function tryStatic(url: string): Promise<TierOutcome> {
  const fetchResult = await fetchStatic(url);
  const extracted = htmlToMarkdown(fetchResult.html, fetchResult.finalUrl);
  return {
    extracted,
    html: fetchResult.html,
    statusCode: fetchResult.statusCode,
    fetchedAt: fetchResult.fetchedAt,
    finalUrl: fetchResult.finalUrl,
  };
}

async function tryHeadless(url: string, storageState?: StorageState): Promise<TierOutcome> {
  const fetchResult = await fetchHeadless(url, undefined, storageState);
  const extracted = htmlToMarkdown(fetchResult.html, fetchResult.finalUrl);
  return {
    extracted,
    html: fetchResult.html,
    statusCode: fetchResult.statusCode,
    fetchedAt: fetchResult.fetchedAt,
    finalUrl: fetchResult.finalUrl,
  };
}

/**
 * Fetches and extracts content for a single URL, escalating from static to
 * headless on outright failure or a suspiciously thin result. The escalation
 * policy lives here once, shared by single-page scrape, each crawl page, and
 * extraction.
 *
 * Both tiers only swallow their own expected fetch-failure (StaticFetchError)
 * into a recorded "attempt failed" — anything else propagates as a genuine
 * failure. Decoupled from config: centsForTier + robotsResolver are injected
 * (defaults provided); scrapeUrlCore itself records no cost (the engine or a
 * wrapper does, via CostRecorder).
 *
 * FR-7 budget: only ever gates a choice between two already-viable results —
 * it never turns a would-be success into a failure. If static failed outright,
 * headless is always attempted regardless of budget.
 *
 * FR-6 storageState: skips the static tier entirely; headless runs directly,
 * pre-authenticated. Not composed with budget (no cheaper fallback to degrade
 * into).
 */
export async function scrapeUrlCore(
  url: string,
  options: ScrapeUrlOptions = {},
  deps: ScrapeUrlDeps = {},
): Promise<ScrapeUrlResult> {
  const centsForTier = deps.centsForTier ?? defaultCentsForTier;
  const robotsResolver = deps.robotsResolver ?? ALLOW_ALL_ROBOTS;
  const { budget, storageState, skipRobotsCheck } = options;

  // One check per top-level URL, before either tier.
  if (!skipRobotsCheck && !(await robotsResolver.isAllowed(url))) {
    throw new RobotsDisallowedError(url);
  }

  const attempts: ScrapeAttempt[] = [];

  if (storageState) {
    let headlessOutcome: TierOutcome | null = null;
    try {
      headlessOutcome = await tryHeadless(url, storageState);
      attempts.push({ tier: "headless", success: true });
    } catch (err) {
      attempts.push({ tier: "headless", success: false });
      if (!(err instanceof StaticFetchError)) throw err;
    }
    if (headlessOutcome === null) throw new ScrapeAllTiersFailedError(url, attempts);
    return toScrapeResult(headlessOutcome, "headless", attempts);
  }

  // Every tier actually billed within this call so far — canAffordTier and
  // describeFetchBudgetOutcome compare the ceiling against this running total,
  // not just the tier under consideration's own price. Without it a static
  // fetch that already succeeded would never count against the ceiling when
  // deciding whether headless still fits.
  let spentCents = 0;

  let staticOutcome: TierOutcome | null = null;
  try {
    staticOutcome = await tryStatic(url);
    attempts.push({ tier: "static", success: true });
    spentCents += centsForTier("static");
  } catch (err) {
    attempts.push({ tier: "static", success: false });
    if (!(err instanceof StaticFetchError)) throw err;
  }

  const staticIsThin =
    staticOutcome !== null && staticOutcome.extracted.text.length < MIN_CONTENT_CHARS;
  const qualityWantsEscalation = staticOutcome === null || staticIsThin;

  let escalationSkippedForBudget: { tier: Tier } | null = null;

  if (qualityWantsEscalation) {
    const hasFallback = staticOutcome !== null;
    if (hasFallback && !canAffordTier(budget, "headless", centsForTier, spentCents)) {
      escalationSkippedForBudget = { tier: "headless" };
    } else {
      let headlessOutcome: TierOutcome | null = null;
      try {
        headlessOutcome = await tryHeadless(url);
        attempts.push({ tier: "headless", success: true });
        spentCents += centsForTier("headless");
      } catch (err) {
        attempts.push({ tier: "headless", success: false });
        if (!(err instanceof StaticFetchError)) throw err;
      }

      const headlessIsBetter =
        headlessOutcome !== null &&
        (staticOutcome === null ||
          headlessOutcome.extracted.text.length > staticOutcome.extracted.text.length);

      if (headlessOutcome !== null && headlessIsBetter) {
        const outcome = budget
          ? describeFetchBudgetOutcome(budget, spentCents, "headless", null, centsForTier)
          : undefined;
        return toScrapeResult(headlessOutcome, "headless", attempts, outcome);
      }
    }
  }

  if (staticOutcome === null) {
    throw new ScrapeAllTiersFailedError(url, attempts);
  }

  const budgetDegradation = budget
    ? describeFetchBudgetOutcome(
        budget,
        spentCents,
        "static",
        escalationSkippedForBudget,
        centsForTier,
      )
    : undefined;
  return toScrapeResult(staticOutcome, "static", attempts, budgetDegradation);
}
