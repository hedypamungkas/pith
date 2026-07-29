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
   *  workers. Omit for BullMQ's default (1). Invalid values (0/negative/NaN)
   *  clamp to 1 — BullMQ's Worker rejects them outright. */
  concurrency?: number;
  /** Observer for BullMQ worker / connection errors (BullMQ only surfaces these
   *  once a listener is attached, so one is always wired — defaulting to
   *  `console.error`). Without it a Redis partition would silently stall the
   *  workers with no signal. Never throws. */
  onError?: (error: Error) => void;
  /** BullMQ key prefix (default `bull`). MUST match the `BullMqJobQueue` prefix
   *  so producer + workers share a keyspace. */
  prefix?: string;
}

export interface WorkerHandle {
  /** Resolve once all workers are connected to Redis and draining. Await before
   *  producing jobs if you need the fleet ready up front (otherwise BullMQ
   *  buffers jobs until a worker connects). */
  ready(): Promise<void>;
  /** Gracefully stop all workers (finish in-flight jobs). Pass `true` to force.
   *  Uses `Promise.allSettled` so every worker is closed even if one rejects. */
  close(force?: boolean): Promise<void>;
}

/** Resolve the worker concurrency: `undefined`/0/negative/NaN/fractional → 1
 *  (sequential). BullMQ's Worker rejects an explicit non-finite-or-<=0 value, so
 *  clamp at this boundary — mirrors the producer's `drainBatchSize` clamp. */
function normalizeWorkerConcurrency(n: number | undefined): number {
  const v = Math.floor(n ?? 1);
  return v >= 1 ? v : 1;
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
 * Crash/resume safety: BullMQ delivers at-least-once, and the crawl-page
 * processor's `getPageStatus` gate makes a redelivered, **already-finalized**
 * page a no-op (returns `[]`) — no re-scrape, no re-bill. (A crash *before* the
 * page is finalized will re-process it; and a crash in the narrow window between
 * `markPageSuccess` and the result return can orphan discovered children — see
 * ADR 0007.)
 */
export function runWorkers(
  connection: QueueConnection,
  opts: RunWorkersOptions,
): WorkerHandle {
  const onError =
    opts.onError ??
    ((error: Error) => console.error("[adapters-bullmq] worker error:", error));
  const workerOpts = {
    connection: normalizeBlockingConnection(connection),
    concurrency: normalizeWorkerConcurrency(opts.concurrency),
    ...(opts.prefix ? { prefix: opts.prefix } : {}),
  };
  const make = <D, R>(name: string, processor: (data: D) => Promise<R>) => {
    const worker = new Worker<D, R>(name, async (job) => processor(job.data), workerOpts);
    worker.on("error", onError);
    return worker;
  };
  const scrapeWorker = make<ScrapeJobData, ScrapeUrlResult>(SCRAPE_QUEUE, opts.scrape);
  const crawlWorker = make<CrawlPageJobData, CrawlPageJobData[]>(
    CRAWL_QUEUE,
    opts.crawlPage,
  );
  const extractWorker = make<ExtractJobData, ExtractResult>(EXTRACT_QUEUE, opts.extract);
  const workers = [scrapeWorker, crawlWorker, extractWorker];
  return {
    ready: () =>
      Promise.all(workers.map((w) => w.waitUntilReady())).then(() => undefined),
    close: (force?: boolean) =>
      Promise.allSettled([
        scrapeWorker.close(force),
        crawlWorker.close(force),
        extractWorker.close(force),
      ]).then((results) => {
        const errs = results
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map((r) => r.reason as Error);
        if (errs.length === 1) throw errs[0]!;
        if (errs.length > 1) {
          throw new AggregateError(
            errs,
            `runWorkers.close: ${errs.length} of 3 workers failed`,
          );
        }
      }),
  };
}

/** Thin factory mirroring the package convention. */
export const createWorkers = runWorkers;
