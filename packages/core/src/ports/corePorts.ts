/**
 * The CorePorts contract.
 *
 * Every host concern the engine can touch (cost metering, request snapshots,
 * crawl state, page-content blob storage, the job queue, robots resolution,
 * freshness cache, and the clock) is an injectable port with an in-memory / no-op
 * default. This is the architectural seam that lets `@use-pith/core` run with zero
 * infrastructure by default while real backends (Postgres / MinIO / BullMQ /
 * Redis) drop in as adapters without touching engine logic.
 *
 * NOTE: these signatures are the scaffold contract — minimal but named. They
 * firm up to their full shapes as the engine modules port in (spin-off step 3);
 * the names and responsibilities below are stable.
 */
import type { ScrapeAttempt } from "../pricing.js";
import type { ScrapeUrlResult, ScrapeUrlOptions } from "../scrape/scrapeUrlCore.js";
import type { ExtractResult } from "../extract/extractPure.js";
import type {
  CreateCrawlInput,
  CrawlPageJobData,
  CrawlStatus,
  DiscoveredPage,
  PageCounts,
  PageStatus,
  ResumablePausedPage,
  CrawlPageDetail,
} from "../crawl/types.js";

export interface CostRecorder {
  recordAttempts(attempts: ScrapeAttempt[]): Promise<void> | void;
  recordCostEvent(event: unknown): Promise<void> | void;
  /** `false` here means idempotency sees a fresh request (no prior bill). */
  hasCostEventForRequest(requestId: string): Promise<boolean> | boolean;
  getCostCentsForRequest(requestId: string): Promise<number> | number;
}

export interface SnapshotStore {
  capture(snapshot: unknown): Promise<void> | void;
  load(requestId: string): Promise<unknown> | unknown;
}

export interface CrawlStateStore {
  createCrawl(input: CreateCrawlInput): Promise<number>;
  markCrawlRunning(crawlId: string): Promise<void>;
  markPageSuccess(pageId: number, requestId: string): Promise<void>;
  markPageFailed(pageId: number, requestId: string, lastError?: string): Promise<void>;
  markPagePaused(pageId: number, requestId: string, reason: string): Promise<void>;
  markPagePending(pageId: number): Promise<void>;
  insertDiscoveredPages(
    crawlId: string,
    maxPages: number,
    pages: Array<{ url: string; depth: number }>,
  ): Promise<DiscoveredPage[]>;
  finalizeCrawlIfDone(crawlId: string): Promise<boolean>;
  getPageStatus(pageId: number): Promise<PageStatus | null>;
  getPageCounts(crawlId: string): Promise<PageCounts>;
  getCrawlStatus(crawlId: string): Promise<CrawlStatus | null>;
  incrementPageAttempt(pageId: number): Promise<void>;
  listPausedPages(authSessionId: string): Promise<ResumablePausedPage[]>;
  listPages(crawlId: string): Promise<CrawlPageDetail[]>;
}

export interface ContentStore {
  put(key: string, body: Uint8Array | string): Promise<void> | void;
  get(key: string): Promise<Uint8Array | string | undefined> | Uint8Array | string | undefined;
  list(prefix: string): Promise<string[]> | string[];
  delete(key: string): Promise<void> | void;
}

/** Payload for {@link JobQueue.addScrape} — the per-job unit of scrape work. */
export interface ScrapeJobData {
  url: string;
  options: ScrapeUrlOptions;
}

/** Payload for {@link JobQueue.addExtract} — the per-job unit of extract work. */
export interface ExtractJobData {
  url: string;
  schema: Record<string, unknown>;
  budgetCents?: number;
  ignoreRobotsTxt?: boolean;
}

/**
 * The job-queue port — the seam that lets scrape / crawl-page / extract work
 * run somewhere other than the calling engine: in-process (the default,
 * {@link InProcessJobQueue}) or on a real runner (`@use-pith/adapters-bullmq`
 * over Redis). Each `addX` drives ONE job to completion and returns its result;
 * the engine's crawl drain loop calls `addCrawlPage` per page, and the public
 * `scrape`/`extract` routes go through `addScrape`/`addExtract`.
 *
 * `concurrency` is the crawl drain loop's frontier size (max crawl-page jobs in
 * flight). `undefined`/1 = sequential (the in-process default — deterministic);
 * a real runner sets it higher for parallelism. It does not affect scrape/extract
 * (single awaits).
 */
export interface JobQueue {
  addScrape(data: ScrapeJobData): Promise<ScrapeUrlResult>;
  addCrawlPage(data: CrawlPageJobData): Promise<CrawlPageJobData[]>;
  addExtract(data: ExtractJobData): Promise<ExtractResult>;
  readonly concurrency?: number;
}

export interface RobotsResolver {
  isAllowed(url: string): Promise<boolean> | boolean;
}

/** A cached scrape, keyed by URL. `content` holds the full `ScrapeUrlResult` so
 * a cache hit replays the exact shape a fresh fetch returns; a prod adapter may
 * offload the bulky `html` to a separate snapshot store and rehydrate it here. */
export interface FreshnessRecord {
  url: string;
  /** The tier currently watching this URL — tightened monotonically by `record`,
   * never loosened. */
  watchedTier: string;
  watchedTierMaxStalenessSeconds: number;
  watchedTierProactiveRecrawl: boolean;
  crawledAt: Date;
  /** `crawledAt + watchedTierMaxStalenessSeconds` — the proactive-recrawl due
   * time. Doubles as the freshness deadline (`withinSla` compares age against
   * `watchedTierMaxStalenessSeconds`). */
  nextDueAt: Date;
  content: ScrapeUrlResult;
}

/** Input to `FreshnessCache.record`. The cache decides — from
 * `requestedTierMaxStalenessSeconds` vs the stored row — whether to adopt the
 * incoming tier or keep the existing (tighter) one. */
export interface RecordFreshnessInput {
  url: string;
  requestedTier: string;
  requestedTierMaxStalenessSeconds: number;
  requestedTierProactiveRecrawl: boolean;
  crawledAt: Date;
  content: ScrapeUrlResult;
}

export interface DueUrl {
  url: string;
  watchedTier: string;
}

export interface FreshnessCache {
  tryGet(url: string): Promise<FreshnessRecord | null>;
  /** Upsert a fresh crawl result. Implementations MUST monotonically TIGHTEN the
   * watched tier (adopt the incoming tier only when it is stricter than the
   * stored one) so two concurrent scrapes of a new URL can't let a
   * last-write-wins downgrade — the in-process equivalent of the source's
   * `LEAST()` + `CASE` tightening upsert. */
  record(input: RecordFreshnessInput): Promise<void>;
  /** URLs past their `nextDueAt` whose tier is `proactiveRecrawl`, as of `now`. */
  listDue(now: Date): Promise<DueUrl[]>;
  /** Erase a URL's cached content (DSAR / cross-tenant erase). Returns whether a
   * row existed. */
  delete(url: string): Promise<boolean>;
}

export type Clock = () => Date;

export interface CorePorts {
  costRecorder: CostRecorder;
  snapshotStore: SnapshotStore;
  crawlStateStore: CrawlStateStore;
  contentStore: ContentStore;
  queue: JobQueue;
  robotsResolver: RobotsResolver;
  freshnessCache: FreshnessCache;
  clock: Clock;
}

/** Identity of the caller for an optional pre-flight hook (billing/auth). */
export interface CallerContext {
  apiKeyId?: string;
}
