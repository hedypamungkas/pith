import { createHash } from "node:crypto";
import { fetchBudgetFrom, type FetchBudget } from "../fetchBudget.js";
import type { CentsForTier } from "../pricing.js";
import type { ExtractionResult } from "../extract/extractionPort.js";
import { verifyCitations } from "../extract/citationVerifier.js";
import { computeFlaggedFields } from "../extract/flaggedFields.js";
import type { RequestSnapshot } from "./snapshotTypes.js";
import type { RequestSnapshotBody } from "./requestSnapshotStore.js";

export interface ReplayedScrape {
  finalUrl: string;
  statusCode: number;
  fetchedAt: string;
  tierUsed: string;
  html: string;
  markdown: string;
  text: string;
}

export interface ReplayScrapeFn {
  (
    url: string,
    options: { budget?: FetchBudget | undefined; skipRobotsCheck?: boolean },
  ): Promise<ReplayedScrape>;
}

export interface ReplayDeps {
  /** Re-fetches the snapshot's URL with the reconstructed options (step 3's
   *  scrapeUrlCore is the canonical implementation). */
  scrape: ReplayScrapeFn;
  /** Optional extraction backend. When absent, only scrape replay is supported
   *  (extract replay throws — scrapeOnlyReplay). */
  extract?: (
    markdown: string,
    text: string,
    schema: Record<string, unknown>,
  ) => Promise<ExtractionResult>;
  /** Price lookup for budget reconstruction. */
  centsForTier: CentsForTier;
}

export interface ReplayResult {
  operation: "scrape" | "extract";
  /** True only when every observable field matched — a replay must reproduce OR
   *  explicitly explain why it can't, never silently differ. Any entry in
   *  `differences` flips this to false. */
  reproduced: boolean;
  differences: string[];
  /** Explanatory context for non-reproduction that isn't itself a "change" —
   *  e.g. extraction LLM non-determinism, a model-config change. */
  notes: string[];
  replayed: {
    finalUrl: string;
    statusCode: number;
    fetchedAt: string;
    tierUsed: string;
    htmlSha256: string;
    markdownSha256: string;
    extraction?: {
      data: Record<string, unknown>;
      confidence: Record<string, number>;
      citations: Record<string, unknown>;
      flaggedFields: string[];
      model: string;
    };
  };
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Re-runs a past request against current config and reports whether it
 * reproduced. Decoupled from the worker/queue path — a replay is a diagnostic.
 * The scrape + (optional) extract implementations are injected so the OSS core
 * has no singleton/config dependency; whole-crawl replay is unsupported (crawl
 * pages remain individually inspectable via their snapshot).
 */
export async function replayRequest(
  snapshot: RequestSnapshot,
  body: RequestSnapshotBody,
  deps: ReplayDeps,
): Promise<ReplayResult> {
  if (snapshot.operation === "crawl_page") {
    throw new Error("Replay is not supported for crawl_page");
  }

  const input = snapshot.input as {
    budgetCents?: number;
    ignoreRobotsTxt?: boolean;
    schema?: Record<string, unknown>;
  };

  // Reconstruct the exact fetch options the original request used, including
  // extraction's price reservation for the extract case — so a tier-escalation
  // difference is a real signal, not an artifact of a different budget shape.
  const options = {
    budget:
      snapshot.operation === "extract"
        ? fetchBudgetFrom(input.budgetCents, deps.centsForTier("extraction"))
        : fetchBudgetFrom(input.budgetCents),
    skipRobotsCheck: input.ignoreRobotsTxt === true,
  };

  const replayedScrape = await deps.scrape(snapshot.url, options);

  const differences: string[] = [];
  const notes: string[] = [];

  if (replayedScrape.finalUrl !== snapshot.finalUrl) {
    differences.push(`finalUrl changed (${snapshot.finalUrl} → ${replayedScrape.finalUrl})`);
  }
  if (replayedScrape.statusCode !== snapshot.statusCode) {
    differences.push(
      `statusCode changed (${snapshot.statusCode} → ${replayedScrape.statusCode})`,
    );
  }
  if (replayedScrape.tierUsed !== snapshot.tierUsed) {
    differences.push(`tierUsed changed (${snapshot.tierUsed} → ${replayedScrape.tierUsed})`);
  }
  // HTML is the authoritative "did the source page change" signal — markdown
  // drifts on cosmetic template/whitespace changes that aren't semantic.
  if (sha(replayedScrape.html) !== sha(body.html)) {
    differences.push("source page content changed (html differs)");
  }

  const replayed: ReplayResult["replayed"] = {
    finalUrl: replayedScrape.finalUrl,
    statusCode: replayedScrape.statusCode,
    fetchedAt: replayedScrape.fetchedAt,
    tierUsed: replayedScrape.tierUsed,
    htmlSha256: sha(replayedScrape.html),
    markdownSha256: sha(replayedScrape.markdown),
  };

  if (snapshot.operation === "scrape") {
    return { operation: "scrape", reproduced: differences.length === 0, differences, notes, replayed };
  }

  if (!deps.extract) {
    throw new Error(
      "Replay of an extract request requires an extract backend (ReplayDeps.extract)",
    );
  }

  // extract — re-run the LLM against the freshly fetched page with the STORED
  // schema (not a current default), then flag any drift.
  const schema = input.schema ?? {};
  const result = await deps.extract(replayedScrape.markdown, replayedScrape.text, schema);
  const citations = verifyCitations(result.citations, replayedScrape.text);
  // Same flagging rule the production worker applies — a replay measures the
  // real behavior, not an approximation.
  const flaggedFields = computeFlaggedFields(result.data, result.confidence, citations);

  const origExtract = (snapshot.extractionResult ?? undefined) as
    | { data?: unknown; model?: string }
    | undefined;

  if (origExtract?.model && origExtract.model !== result.model) {
    notes.push(`extraction model changed (${origExtract.model} → ${result.model})`);
  }
  // LLM output is non-deterministic: byte-identical reproduction is not
  // guaranteed even with an unchanged page. A data difference is therefore
  // reported AND explained, never silently returned as "the same."
  if (JSON.stringify(origExtract?.data) !== JSON.stringify(result.data)) {
    differences.push("extraction data differs");
    notes.push("extraction_llm_nondeterministic");
  }

  replayed.extraction = {
    data: result.data,
    confidence: result.confidence,
    citations,
    flaggedFields,
    model: result.model,
  };

  return {
    operation: "extract",
    reproduced: differences.length === 0,
    differences,
    notes,
    replayed,
  };
}
