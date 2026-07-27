import { fetchBudgetFrom, type FetchBudget, type FetchBudgetOutcome } from "../fetchBudget.js";
import type { CentsForTier } from "../pricing.js";
import type { ExtractionResult } from "./extractionPort.js";
import { verifyCitations, type VerifiedCitation } from "./citationVerifier.js";
import { computeFlaggedFields } from "./flaggedFields.js";
import type { ScrapeUrlResult } from "../scrape/scrapeUrlCore.js";

export interface ExtractPureDeps {
  /** The fetch+extract-content step (step 3's scrapeUrlCore, wired by the engine). */
  scrape: (
    url: string,
    options: { budget?: FetchBudget; skipRobotsCheck?: boolean },
  ) => Promise<ScrapeUrlResult>;
  /** The LLM extraction backend. */
  extract: (
    markdown: string,
    text: string,
    schema: Record<string, unknown>,
  ) => Promise<ExtractionResult>;
  /** Price lookup (the extraction tier's flat price is reserved up front). */
  centsForTier: CentsForTier;
}

export interface ExtractPureInput {
  url: string;
  schema: Record<string, unknown>;
  budgetCents?: number;
  ignoreRobotsTxt?: boolean;
}

export interface ExtractResult {
  url: string;
  data: Record<string, unknown>;
  confidence: Record<string, number>;
  citations: Record<string, VerifiedCitation>;
  flaggedFields: string[];
  model: string;
  budgetDegradation?: FetchBudgetOutcome;
}

/**
 * Fetches the URL (reusing the same tier-escalation as scrape, with extraction's
 * flat price reserved against the budget *before* the fetch-tier decision), then
 * extracts structured data per the caller's schema, verifies the citations
 * against the fetched plain text, and flags low-confidence / weakly-cited fields.
 *
 * Pure: no queue, no DB, no singleton. The scrape fn + extraction backend +
 * centsForTier are injected. The BullMQ-redelivery idempotency probe
 * (hasCostEventForRequest) from the source worker is deliberately NOT here — it
 * is host-side bookkeeping, not extraction logic.
 */
export async function extractPure(
  input: ExtractPureInput,
  deps: ExtractPureDeps,
): Promise<ExtractResult> {
  // Extraction's own price is fixed and never degraded — it's reserved against
  // the ceiling *before* the fetch-tier decision, so a low budget_cents forces a
  // static-only fetch sooner than the same budget_cents would on a plain scrape.
  const options = {
    budget: fetchBudgetFrom(input.budgetCents, deps.centsForTier("extraction")),
    skipRobotsCheck: input.ignoreRobotsTxt,
  };

  const scraped = await deps.scrape(input.url, options);
  const result = await deps.extract(scraped.markdown, scraped.text, input.schema);

  const citations = verifyCitations(result.citations, scraped.text);
  // FR-4 (low confidence) OR FR-8 (weak citation) — centralized so replay
  // measures the same rule.
  const flaggedFields = computeFlaggedFields(result.data, result.confidence, citations);

  return {
    url: scraped.finalUrl,
    data: result.data,
    confidence: result.confidence,
    citations,
    flaggedFields,
    model: result.model,
    budgetDegradation: scraped.budgetDegradation,
  };
}
