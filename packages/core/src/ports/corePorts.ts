/**
 * The CorePorts contract.
 *
 * Every host concern the engine can touch (cost metering, request snapshots,
 * crawl state, page-content blob storage, the job queue, robots resolution,
 * freshness cache, and the clock) is an injectable port with an in-memory / no-op
 * default. This is the architectural seam that lets `@pith/core` run with zero
 * infrastructure by default while real backends (Postgres / MinIO / BullMQ /
 * Redis) drop in as adapters without touching engine logic.
 *
 * NOTE: these signatures are the scaffold contract — minimal but named. They
 * firm up to their full shapes as the engine modules port in (spin-off step 3);
 * the names and responsibilities below are stable.
 */
import type { ScrapeAttempt } from "../pricing.js";
import type {
  CreateCrawlInput,
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

export interface JobQueue {
  addScrape(payload: unknown): Promise<unknown> | unknown;
  addCrawlPage(payload: unknown): Promise<unknown> | unknown;
  addExtract(payload: unknown): Promise<unknown> | unknown;
  wait(jobId: string): Promise<unknown> | unknown;
}

export interface RobotsResolver {
  isAllowed(url: string): Promise<boolean> | boolean;
}

export interface FreshnessCache {
  tryGet(url: string): Promise<unknown> | unknown;
  record(input: unknown): Promise<void> | void;
  listDue(): Promise<unknown[]> | unknown[];
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
