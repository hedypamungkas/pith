import { NotConfiguredError } from "./errors.js";
import type { CorePorts } from "./ports/corePorts.js";
import { createNullPorts } from "./ports/nullPorts.js";
import { centsForTier } from "./pricing.js";
import {
  scrapeUrlCore,
  type ScrapeUrlResult,
  type ScrapeUrlOptions,
} from "./scrape/scrapeUrlCore.js";
import { extractPure, type ExtractResult } from "./extract/extractPure.js";
import type { ExtractionBackend } from "./extract/extractionPort.js";
import type {
  SearchBackend,
  SearchOptions,
  SearchResponse,
} from "./search/searchPort.js";
import {
  pureCrawler,
  type CrawlHandle,
  type CrawlKickoffOptions,
} from "./crawl/pureCrawler.js";
import type { StorageState } from "./types.js";
import { composeFreshness } from "./freshness/composeFreshness.js";
import { DEFAULT_TIER_CATALOG, type FreshnessTierCatalog } from "./freshness/freshnessTiers.js";

export interface EngineOptions extends Partial<CorePorts> {
  /** Required for engine.extract(); extract throws NotConfiguredError without it. */
  extractionBackend?: ExtractionBackend;
  /** Required for engine.search(); search throws NotConfiguredError without it. */
  searchBackend?: SearchBackend;
  /** Freshness tier catalog used when a scrape opts in via `freshnessTier`.
   * Defaults to `DEFAULT_TIER_CATALOG` (news/standard). */
  freshnessTierCatalog?: FreshnessTierCatalog;
}

export interface ExtractOptions {
  budgetCents?: number;
  ignoreRobotsTxt?: boolean;
}

export interface CrawlOptions {
  maxDepth?: number;
  maxPages?: number;
  sameDomainOnly?: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
  ignoreRobotsTxt?: boolean;
  apiKeyId?: number;
  authSessionId?: string;
  storageState?: StorageState;
}

export interface Engine {
  /** The resolved, fully-populated port set (null defaults + caller overrides). */
  ports: CorePorts;
  /** Single-page scrape (static → headless escalation). */
  scrape(url: string, opts?: ScrapeUrlOptions): Promise<ScrapeUrlResult>;
  /** Provider-agnostic structured extraction + citation verification. */
  extract(
    url: string,
    schema: Record<string, unknown>,
    opts?: ExtractOptions,
  ): Promise<ExtractResult>;
  /** Search via the configured SearchBackend. */
  search(query: string, opts?: SearchOptions): Promise<SearchResponse>;
  /** Multi-page crawl orchestration (in-process, sequential). Returns a handle
   *  whose wait() drains to a terminal CrawlStatus. */
  crawl(url: string, opts?: CrawlOptions): Promise<CrawlHandle>;
}

/**
 * Construct a Pith engine. With no arguments it runs entirely on in-memory /
 * no-op ports — zero infrastructure, zero API keys. Pass overrides to swap in
 * real adapters, and pass extractionBackend/searchBackend to enable
 * extract/search (they have no silent default — a billable provider must never
 * be assumed).
 *
 *   const pith = createEngine();                                      // scrape works
 *   const pith = createEngine({ extractionBackend: createExtractionBackend(...) });
 */
export function createEngine(options: EngineOptions = {}): Engine {
  const ports: CorePorts = { ...createNullPorts(), ...options };
  const extractionBackend = options.extractionBackend;
  const searchBackend = options.searchBackend;
  const tierCatalog = options.freshnessTierCatalog ?? DEFAULT_TIER_CATALOG;

  // Fetch + best-effort cost audit (NoopCostRecorder by default — never throws).
  // Shared by the direct scrape path and the freshness wrapper, so cost is
  // recorded exactly once per fetch (a freshness cache HIT skips the fetch and
  // thus records nothing — parity with the source's zero-cost cache tier).
  const scrapeAndRecord = async (
    url: string,
    opts?: ScrapeUrlOptions,
  ): Promise<ScrapeUrlResult> => {
    const result = await scrapeUrlCore(url, opts, {
      centsForTier,
      robotsResolver: ports.robotsResolver,
    });
    try {
      await ports.costRecorder.recordAttempts(result.attempts);
    } catch {
      /* cost recording must never break a successful scrape */
    }
    return result;
  };

  // Freshness (stale-while-revalidate) is OPT-IN: only when the caller sets
  // `opts.freshnessTier`. Unset → the zero-cache direct path (default).
  const scrapeWithFreshness = composeFreshness(scrapeAndRecord, {
    cache: ports.freshnessCache,
    tierCatalog,
    clock: ports.clock,
  });
  const scrape = async (
    url: string,
    opts?: ScrapeUrlOptions,
  ): Promise<ScrapeUrlResult> => {
    if (opts?.freshnessTier) return scrapeWithFreshness(url, opts);
    return scrapeAndRecord(url, opts);
  };

  const extract = async (
    url: string,
    schema: Record<string, unknown>,
    opts: ExtractOptions = {},
  ): Promise<ExtractResult> => {
    if (!extractionBackend) {
      throw new NotConfiguredError(
        "engine.extract",
        "Pass extractionBackend to createEngine({ extractionBackend }).",
      );
    }
    return extractPure(
      { url, schema, budgetCents: opts.budgetCents, ignoreRobotsTxt: opts.ignoreRobotsTxt },
      {
        scrape,
        extract: extractionBackend.extract.bind(extractionBackend),
        centsForTier,
      },
    );
  };

  const search = async (
    query: string,
    opts: SearchOptions = {},
  ): Promise<SearchResponse> => {
    if (!searchBackend) {
      throw new NotConfiguredError(
        "engine.search",
        "Pass searchBackend to createEngine({ searchBackend }).",
      );
    }
    return searchBackend.search(query, opts);
  };

  const crawler = pureCrawler({
    scrape: (url, opts) =>
      scrapeUrlCore(url, opts, {
        centsForTier,
        robotsResolver: ports.robotsResolver,
      }),
    stateStore: ports.crawlStateStore,
    contentStore: ports.contentStore,
    snapshotStore: ports.snapshotStore,
    costRecorder: ports.costRecorder,
  });
  const crawl = async (
    url: string,
    opts: CrawlOptions = {},
  ): Promise<CrawlHandle> => {
    const bounds: CrawlKickoffOptions = {
      maxDepth: opts.maxDepth ?? 2,
      maxPages: opts.maxPages ?? 50,
      sameDomainOnly: opts.sameDomainOnly ?? true,
      includePatterns: opts.includePatterns,
      excludePatterns: opts.excludePatterns,
      ignoreRobotsTxt: opts.ignoreRobotsTxt ?? false,
      apiKeyId: opts.apiKeyId,
      authSessionId: opts.authSessionId,
      storageState: opts.storageState,
    };
    return crawler.crawl(url, bounds);
  };

  return { ports, scrape, extract, search, crawl };
}
