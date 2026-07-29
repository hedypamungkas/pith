import { NotConfiguredError } from "./errors.js";
import type { CorePorts } from "./ports/corePorts.js";
import { createNullPorts } from "./ports/nullPorts.js";
import { InProcessJobQueue } from "./ports/inProcessJobQueue.js";
import { createScrapeProcessor, createExtractProcessor } from "./ports/jobProcessors.js";
import { centsForTier } from "./pricing.js";
import {
  scrapeUrlCore,
  type ScrapeUrlResult,
  type ScrapeUrlOptions,
} from "./scrape/scrapeUrlCore.js";
import type { ExtractResult } from "./extract/extractPure.js";
import type { ExtractionBackend } from "./extract/extractionPort.js";
import type {
  SearchBackend,
  SearchOptions,
  SearchResponse,
} from "./search/searchPort.js";
import {
  pureCrawler,
  createCrawlPageProcessor,
  type CrawlHandle,
  type CrawlKickoffOptions,
} from "./crawl/pureCrawler.js";
import type { StorageState } from "./types.js";
import { composeFreshness } from "./freshness/composeFreshness.js";
import {
  DEFAULT_TIER_CATALOG,
  type FreshnessTierCatalog,
} from "./freshness/freshnessTiers.js";

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
  /** Multi-page crawl orchestration (sequential by default; pass a concurrent
   *  `queue` for parallelism). Returns a handle whose wait() drains to a
   *  terminal CrawlStatus. */
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

  // --- job processors -------------------------------------------------------
  // One pure processor per job type. The in-process default queue runs them
  // inline; a future remote worker (e.g. a BullMQ-backed adapter) runs them
  // remotely. Built here so every backend runs identical logic.

  // processScrape = scrapeUrlCore + best-effort cost audit (the function
  // formerly named scrapeAndRecord). NoopCostRecorder by default — never throws.
  // (Freshness sits ABOVE the queued fetch: a cache HIT skips the job entirely,
  // so processScrape never runs and records nothing — see queuedScrape below.)
  const processScrape = createScrapeProcessor({
    centsForTier,
    robotsResolver: ports.robotsResolver,
    costRecorder: ports.costRecorder,
  });

  // The crawl-page processor's fetch step is raw scrapeUrlCore (the processor
  // records cost itself), NOT the cost-recording processScrape.
  const crawlScrape = (
    url: string,
    opts: { storageState?: StorageState; skipRobotsCheck?: boolean },
  ) => scrapeUrlCore(url, opts, { centsForTier, robotsResolver: ports.robotsResolver });
  const processCrawlPage = createCrawlPageProcessor({
    scrape: crawlScrape,
    stateStore: ports.crawlStateStore,
    contentStore: ports.contentStore,
    snapshotStore: ports.snapshotStore,
    costRecorder: ports.costRecorder,
  });

  const processExtract = extractionBackend
    ? createExtractProcessor({
        scrape: processScrape, // extract's fetch step runs inline — no queue recursion
        extract: extractionBackend.extract.bind(extractionBackend),
        centsForTier,
      })
    : async () => {
        throw new NotConfiguredError(
          "engine.extract",
          "Pass extractionBackend to createEngine({ extractionBackend }).",
        );
      };

  // The default queue runs the processors inline (sequential, zero infra); pass
  // options.queue (e.g. BullMqJobQueue) to run them on a real runner. Always
  // set here — createNullPorts only provides a throwing placeholder.
  ports.queue =
    options.queue ??
    new InProcessJobQueue({
      scrape: processScrape,
      crawlPage: processCrawlPage,
      extract: processExtract,
    });

  // --- scrape ---------------------------------------------------------------
  // The actual fetch routes through the queue. Freshness (opt-in via
  // freshnessTier) sits ABOVE the queued fetch: a cache HIT skips the job.
  const queuedScrape = (url: string, opts?: ScrapeUrlOptions): Promise<ScrapeUrlResult> =>
    ports.queue.addScrape({ url, options: opts ?? {} });
  const scrapeWithFreshness = composeFreshness(queuedScrape, {
    cache: ports.freshnessCache,
    tierCatalog,
    clock: ports.clock,
  });
  const scrape = async (
    url: string,
    opts?: ScrapeUrlOptions,
  ): Promise<ScrapeUrlResult> => {
    if (opts?.freshnessTier) return scrapeWithFreshness(url, opts);
    return queuedScrape(url, opts);
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
    return ports.queue.addExtract({
      url,
      schema,
      budgetCents: opts.budgetCents,
      ignoreRobotsTxt: opts.ignoreRobotsTxt,
    });
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
    scrape: crawlScrape,
    stateStore: ports.crawlStateStore,
    contentStore: ports.contentStore,
    snapshotStore: ports.snapshotStore,
    costRecorder: ports.costRecorder,
    queue: ports.queue,
  });
  const crawl = async (url: string, opts: CrawlOptions = {}): Promise<CrawlHandle> => {
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
