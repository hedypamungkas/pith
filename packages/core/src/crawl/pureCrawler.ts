import { randomUUID } from "node:crypto";
import { extractLinks } from "./linkExtractor.js";
import { objectKeyForCrawlPage } from "./crawlPageContentStore.js";
import {
  ScrapeAllTiersFailedError,
  type ScrapeUrlResult,
} from "../scrape/scrapeUrlCore.js";
import type {
  CrawlStateStore,
  ContentStore,
  CostRecorder,
  SnapshotStore,
  JobQueue,
} from "../ports/corePorts.js";
import type {
  CrawlBounds,
  CrawlPageJobData,
  CrawlStatus,
} from "./types.js";
import type { StorageState } from "../types.js";

/** The fetch + state + storage deps a crawl-page processor needs. Shared by the
 *  engine (which builds the in-process default) and a BullMQ worker (PR2). */
export interface CrawlProcessorDeps {
  /** The fetch+content step (scrapeUrlCore, wired without cost recording — the
   *  crawler records cost itself). */
  scrape: (
    url: string,
    options: { storageState?: StorageState; skipRobotsCheck?: boolean },
  ) => Promise<ScrapeUrlResult>;
  stateStore: CrawlStateStore;
  contentStore: ContentStore;
  snapshotStore?: SnapshotStore;
  costRecorder?: CostRecorder;
  /** Per-page billing/rate/auth gate. Return an error string to fail the page,
   *  or null to allow. Default: allow all (the OSS spine has no billing). */
  preFlight?: (data: CrawlPageJobData) => Promise<string | null>;
}

/** {@link CrawlProcessorDeps} plus the queue the drain loop drives. */
export interface PureCrawlerDeps extends CrawlProcessorDeps {
  queue: JobQueue;
}

export interface CrawlKickoffOptions extends CrawlBounds {
  apiKeyId?: number;
  authSessionId?: string;
  storageState?: StorageState;
}

export interface CrawlHandle {
  crawlId: string;
  status(): Promise<CrawlStatus | null>;
  /** Process every queued page until the crawl reaches a terminal status. */
  wait(): Promise<CrawlStatus>;
}

/** The per-page processor's outcome: the child jobs it discovered (for the
 *  driver to enqueue), or [] for a no-op / terminal failure. */
type ProcessOutcome = CrawlPageJobData[];

/**
 * Build the per-page crawl processor — the single unit of work the in-process
 * queue runs inline and a BullMQ worker runs remotely. It mirrors the source
 * project's crawlPageWorker: idempotency gate → markCrawlRunning → optional
 * preFlight → incrementPageAttempt → scrape → record cost → write content +
 * snapshot → insert discovered children (BEFORE marking the parent success, so
 * a concurrent finalizer can't see zero pending) → markPageSuccess →
 * finalizeCrawlIfDone. A `ScrapeAllTiersFailedError` is a terminal page failure;
 * other throws propagate.
 *
 * Resume / redelivery idempotency is the getPageStatus gate: a re-driven
 * success/failed page is a no-op, never re-scraped or re-billed — so a crashed
 * worker that already finalized a page is safe to re-drive.
 */
export function createCrawlPageProcessor(
  deps: CrawlProcessorDeps,
): (data: CrawlPageJobData) => Promise<ProcessOutcome> {
  const { scrape, stateStore, contentStore, snapshotStore, costRecorder, preFlight } = deps;

  async function enqueueDiscoveredLinks(
    data: CrawlPageJobData,
    html: string,
    finalUrl: string,
  ): Promise<CrawlPageJobData[]> {
    if (data.depth >= data.maxDepth) return [];
    const discovered = extractLinks(html, finalUrl, {
      sameDomainOnly: data.sameDomainOnly,
      includePatterns: data.includePatterns,
      excludePatterns: data.excludePatterns,
    });
    const inserted = await stateStore.insertDiscoveredPages(
      data.crawlId,
      data.maxPages,
      discovered.map((url) => ({ url, depth: data.depth + 1 })),
    );
    return inserted.map((p) => ({
      ...data,
      pageId: p.id,
      url: p.url,
      depth: data.depth + 1,
    }));
  }

  async function processPage(data: CrawlPageJobData): Promise<ProcessOutcome> {
    // Idempotency gate — a redelivered job for an already-terminal page is a no-op.
    const existing = await stateStore.getPageStatus(data.pageId);
    if (existing === "success" || existing === "failed") return [];

    const requestId = randomUUID();
    await stateStore.markCrawlRunning(data.crawlId);

    if (preFlight) {
      const blocked = await preFlight(data);
      if (blocked) {
        await stateStore.markPageFailed(data.pageId, requestId, blocked);
        await stateStore.finalizeCrawlIfDone(data.crawlId);
        return [];
      }
    }

    await stateStore.incrementPageAttempt(data.pageId);

    let result: ScrapeUrlResult;
    try {
      result = await scrape(data.url, {
        storageState: data.storageState,
        skipRobotsCheck: data.ignoreRobotsTxt,
      });
    } catch (err) {
      if (err instanceof ScrapeAllTiersFailedError) {
        try {
          await costRecorder?.recordAttempts(err.attempts);
        } catch {
          /* cost must never break a crawl */
        }
        await stateStore.markPageFailed(data.pageId, requestId, err.message);
        await stateStore.finalizeCrawlIfDone(data.crawlId);
        return [];
      }
      throw err;
    }

    try {
      await costRecorder?.recordAttempts(result.attempts);
    } catch {
      /* never break a crawl over cost recording */
    }
    try {
      await contentStore.put(
        objectKeyForCrawlPage(data.crawlId, data.pageId),
        result.markdown,
      );
    } catch {
      /* content-store failure is non-fatal to the crawl state machine */
    }
    try {
      await snapshotStore?.capture({
        requestId,
        operation: "crawl_page",
        url: data.url,
        input: { crawlId: data.crawlId, pageId: data.pageId, depth: data.depth },
        tierUsed: result.tierUsed,
        statusCode: result.statusCode,
        finalUrl: result.finalUrl,
        fetchedAt: result.fetchedAt,
        attempts: result.attempts,
        body: {
          markdown: result.markdown,
          text: result.text,
          html: result.html,
          title: result.title,
        },
      });
    } catch {
      /* snapshot capture never throws (FR-10 contract) */
    }

    // Insert children BEFORE marking this page success (finalize ordering:
    // a sibling finalizing at this instant must still see pending work).
    const children = await enqueueDiscoveredLinks(data, result.html, result.finalUrl);
    await stateStore.markPageSuccess(data.pageId, requestId);
    await stateStore.finalizeCrawlIfDone(data.crawlId);
    return children;
  }

  return processPage;
}

/**
 * The crawl orchestration, decoupled from BullMQ/Redis/Postgres. The drain loop
 * drives `queue.addCrawlPage` one frontier at a time — up to `queue.concurrency`
 * pages in flight per batch — and pushes the discovered children back. The
 * default in-process queue runs the processor inline, so at `concurrency` 1
 * (undefined) this is the original deterministic sequential crawl; a real runner
 * (BullMQ) sets `concurrency` for parallelism and runs each job on a worker.
 */
export function pureCrawler(deps: PureCrawlerDeps) {
  const { stateStore, queue } = deps;
  const processPage = createCrawlPageProcessor(deps);

  async function crawl(rootUrl: string, opts: CrawlKickoffOptions): Promise<CrawlHandle> {
    const crawlId = randomUUID();
    const rootPageId = await stateStore.createCrawl({
      id: crawlId,
      rootUrl,
      apiKeyId: opts.apiKeyId ?? 0,
      authSessionId: opts.authSessionId,
      maxDepth: opts.maxDepth,
      maxPages: opts.maxPages,
      sameDomainOnly: opts.sameDomainOnly,
      includePatterns: opts.includePatterns,
      excludePatterns: opts.excludePatterns,
      ignoreRobotsTxt: opts.ignoreRobotsTxt,
    });
    const rootJob: CrawlPageJobData = {
      crawlId,
      apiKeyId: opts.apiKeyId ?? 0,
      authSessionId: opts.authSessionId,
      pageId: rootPageId,
      url: rootUrl,
      depth: 0,
      maxDepth: opts.maxDepth,
      maxPages: opts.maxPages,
      sameDomainOnly: opts.sameDomainOnly,
      includePatterns: opts.includePatterns,
      excludePatterns: opts.excludePatterns,
      ignoreRobotsTxt: opts.ignoreRobotsTxt,
      storageState: opts.storageState,
    };
    return {
      crawlId,
      status: () => stateStore.getCrawlStatus(crawlId),
      wait: async (): Promise<CrawlStatus> => {
        const n = queue.concurrency ?? 1;
        const pending: CrawlPageJobData[] = [rootJob];
        while (pending.length > 0) {
          const batch = pending.splice(0, n);
          const children = (
            await Promise.all(batch.map((data) => queue.addCrawlPage(data)))
          ).flat();
          pending.push(...children);
        }
        const status = await stateStore.getCrawlStatus(crawlId);
        if (!status) throw new Error(`Crawl ${crawlId} vanished mid-run`);
        return status;
      },
    };
  }

  return { crawl, processPage };
}
