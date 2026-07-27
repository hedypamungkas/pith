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
} from "../ports/corePorts.js";
import type {
  CrawlBounds,
  CrawlPageJobData,
  CrawlStatus,
} from "./types.js";
import type { StorageState } from "../types.js";

export interface PureCrawlerDeps {
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
 * The crawl orchestration, decoupled from BullMQ/Redis/Postgres. The per-page
 * processor mirrors the source project's crawlPageWorker: idempotency gate →
 * markCrawlRunning → optional preFlight → incrementPageAttempt → scrape → record
 * cost → write content + snapshot → insert discovered children (BEFORE marking
 * the parent success, so a concurrent finalizer can't see zero pending) →
 * markPageSuccess → finalizeCrawlIfDone. A `ScrapeAllTiersFailedError` is a
 * terminal page failure; other throws propagate.
 *
 * The driver is a sequential in-process work queue (deterministic, no
 * concurrency — prod gets concurrency from BullMQ). Resume / redelivery
 * idempotency is the getPageStatus gate: a re-driven success/failed page is a
 * no-op, never re-scraped or re-billed.
 */
export function pureCrawler(deps: PureCrawlerDeps) {
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
    const queue: CrawlPageJobData[] = [
      {
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
      },
    ];
    return {
      crawlId,
      status: () => stateStore.getCrawlStatus(crawlId),
      wait: async (): Promise<CrawlStatus> => {
        while (queue.length > 0) {
          const data = queue.shift()!;
          const children = await processPage(data);
          queue.push(...children);
        }
        const status = await stateStore.getCrawlStatus(crawlId);
        if (!status) throw new Error(`Crawl ${crawlId} vanished mid-run`);
        return status;
      },
    };
  }

  return { crawl, processPage };
}
