import { Worker } from "bullmq";
import type {
  ScrapeProcessor,
  CrawlPageProcessor,
  ExtractProcessor,
  ScrapeJobData,
  ScrapeUrlResult,
  CrawlPageJobData,
  ExtractJobData,
  ExtractResult,
} from "@use-pith/core";
import { SCRAPE_QUEUE, CRAWL_QUEUE, EXTRACT_QUEUE } from "./queueNames.js";
import { normalizeBlockingConnection, type QueueConnection } from "./connection.js";

export interface RunWorkersOptions {
  /** The three processors the workers run per job — built by the host from the
   *  core factories (`createScrapeProcessor` / `createCrawlPageProcessor` /
   *  `createExtractProcessor`) with REAL deps, exactly as `createEngine` builds
   *  them. The worker process passes the job's data to the processor and returns
   *  its result so the producer's `waitUntilFinished` yields it. */
  scrape: ScrapeProcessor;
  crawlPage: CrawlPageProcessor;
  extract: ExtractProcessor;
  /** In-flight jobs per worker (BullMQ Worker concurrency). Set to match
   *  `BullMqJobQueue.concurrency` so the producer's batch width saturates the
   *  workers. Omit for BullMQ's default (1). */
  concurrency?: number;
}

export interface WorkerHandle {
  /** Gracefully stop all workers (finish in-flight jobs). Pass `true` to force. */
  close(force?: boolean): Promise<void>;
}

/**
 * Start the three BullMQ workers (one per queue) that drain scrape / crawl-page
 * / extract jobs produced by a {@link BullMqJobQueue} on the SAME Redis and
 * queue names. The adapter stays pure: it runs only the processors the host
 * supplies (never imports `scrapeUrlCore`/pricing/extraction backends), so
 * "no infrastructure on import" is preserved and the worker runs identical logic
 * to the in-process engine.
 *
 *   const workers = runWorkers(redis, { scrape, crawlPage, extract, concurrency: 8 });
 *   // ... later
 *   await workers.close();
 *
 * Crash/resume safety composes for free: BullMQ delivers at-least-once, and the
 * crawl-page processor's `getPageStatus` gate makes a redelivered, already-
 * finalized page a no-op (returns `[]`) — no re-scrape, no re-bill.
 */
export function runWorkers(
  connection: QueueConnection,
  opts: RunWorkersOptions,
): WorkerHandle {
  // BullMQ's Worker rejects an explicit `concurrency: undefined` (it wants the
  // key omitted or a finite number > 0); default to its own default of 1.
  const workerOpts = {
    connection: normalizeBlockingConnection(connection),
    concurrency: opts.concurrency ?? 1,
  };
  const scrapeWorker = new Worker<ScrapeJobData, ScrapeUrlResult>(
    SCRAPE_QUEUE,
    async (job) => opts.scrape(job.data),
    workerOpts,
  );
  const crawlWorker = new Worker<CrawlPageJobData, CrawlPageJobData[]>(
    CRAWL_QUEUE,
    async (job) => opts.crawlPage(job.data),
    workerOpts,
  );
  const extractWorker = new Worker<ExtractJobData, ExtractResult>(
    EXTRACT_QUEUE,
    async (job) => opts.extract(job.data),
    workerOpts,
  );
  return {
    close: (force?: boolean) =>
      Promise.all([
        scrapeWorker.close(force),
        crawlWorker.close(force),
        extractWorker.close(force),
      ]).then(() => undefined),
  };
}

/** Thin factory mirroring the package convention. */
export const createWorkers = runWorkers;
