import { scrapeUrlCore } from "../scrape/scrapeUrlCore.js";
import type { ScrapeUrlResult } from "../scrape/scrapeUrlCore.js";
import { extractPure } from "../extract/extractPure.js";
import type { CentsForTier } from "../pricing.js";
import type {
  CostRecorder,
  RobotsResolver,
  ScrapeJobData,
  ScrapeProcessor,
  ExtractProcessor,
} from "./corePorts.js";
import type { ExtractionResult } from "../extract/extractionPort.js";

/**
 * The scrape job processor — the work a `JobQueue.addScrape` job does, in one
 * place so the in-process default and a future remote worker run identical
 * logic. This is the engine's `processScrape` (the function formerly named
 * `scrapeAndRecord`): `scrapeUrlCore` + a best-effort cost audit that never
 * breaks a successful scrape.
 */
export interface ScrapeProcessorDeps {
  centsForTier: CentsForTier;
  robotsResolver: RobotsResolver;
  costRecorder: CostRecorder;
}
export function createScrapeProcessor(deps: ScrapeProcessorDeps): ScrapeProcessor {
  return async (data) => {
    const result = await scrapeUrlCore(data.url, data.options, {
      centsForTier: deps.centsForTier,
      robotsResolver: deps.robotsResolver,
    });
    try {
      await deps.costRecorder.recordAttempts(result.attempts);
    } catch {
      /* cost recording must never break a successful scrape */
    }
    return result;
  };
}

/**
 * The extract job processor — the work a `JobQueue.addExtract` job does. Runs
 * `extractPure` with the **scrape processor** as its fetch step (run inline
 * inside the worker), NOT the engine's enqueuing `scrape` — so extract never
 * re-enqueues a scrape job (no queue recursion). Behavior-identical to today:
 * the engine's `extract` already calls `scrape` without `freshnessTier`, i.e.
 * the scrape processor (`processScrape`).
 */
export interface ExtractProcessorDeps {
  /** The scrape processor — extract's fetch step, run inline. */
  scrape: (data: ScrapeJobData) => Promise<ScrapeUrlResult>;
  /** The LLM extraction backend. */
  extract: (
    markdown: string,
    text: string,
    schema: Record<string, unknown>,
  ) => Promise<ExtractionResult>;
  centsForTier: CentsForTier;
}
export function createExtractProcessor(deps: ExtractProcessorDeps): ExtractProcessor {
  return (data) =>
    extractPure(
      {
        url: data.url,
        schema: data.schema,
        budgetCents: data.budgetCents,
        ignoreRobotsTxt: data.ignoreRobotsTxt,
      },
      {
        // extractPure calls scrape(url, { budget?, skipRobotsCheck? }) — adapt
        // into the scrape processor's ScrapeJobData shape.
        scrape: (url, options) => deps.scrape({ url, options }),
        extract: deps.extract,
        centsForTier: deps.centsForTier,
      },
    );
}
