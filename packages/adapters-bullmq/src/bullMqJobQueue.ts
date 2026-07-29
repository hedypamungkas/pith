import { Queue, QueueEvents } from "bullmq";
import type {
  JobQueue,
  ScrapeJobData,
  ScrapeUrlResult,
  CrawlPageJobData,
  ExtractJobData,
  ExtractResult,
} from "@use-pith/core";
import {
  SCRAPE_QUEUE,
  CRAWL_QUEUE,
  EXTRACT_QUEUE,
  SCRAPE_JOB,
  CRAWL_JOB,
  EXTRACT_JOB,
  DEFAULT_JOB_OPTIONS,
} from "./queueNames.js";
import {
  normalizeQueueConnection,
  normalizeBlockingConnection,
  type QueueConnection,
} from "./connection.js";

/**
 * Default bound on how long an `addX` waits for a worker to finish a job.
 * Without a bound, a hung worker processor (or no worker running at all) would
 * hang `addX` — and thus the crawl drain `wait()` — forever, silently. Two
 * minutes covers even a slow headless scrape; raise `waitTimeoutMs` for
 * legitimately slower jobs. BullMQ rejects with a "timed out before finishing"
 * error on expiry (the crawl drain's `Promise.allSettled` then surfaces it).
 */
export const DEFAULT_WAIT_TIMEOUT_MS = 120_000;

export interface BullMqJobQueueOptions {
  /** The crawl drain loop's batch width — set to match the worker `concurrency`
   *  so the drain keeps the workers fed (the engine reads this at
   *  `pureCrawler.drainBatchSize`). Omit for sequential (undefined ⇒ 1).
   *  Scrape/extract ignore it (single awaits). */
  concurrency?: number;
  /** Max ms to wait for any single job's result before rejecting. Defaults to
   *  {@link DEFAULT_WAIT_TIMEOUT_MS}. Raise it for legitimately slow jobs. */
  waitTimeoutMs?: number;
  /** Observer for BullMQ connection errors on the producer's Queues /
   *  QueueEvents (BullMQ only surfaces these once a listener is attached, so
   *  one is always wired — defaulting to `console.error`). Never throws. */
  onError?: (error: Error) => void;
  /** BullMQ key prefix (default `bull`). Set the SAME value on the matching
   *  `runWorkers(...)` so producer + workers share a keyspace; a unique prefix
   *  per deployment isolates queues on a shared Redis. */
  prefix?: string;
}

/**
 * A Redis-backed {@link JobQueue} — the producer side. Each `addX` enqueues one
 * job on its dedicated queue and awaits the worker's return value via
 * `Job.waitUntilFinished` (the BullMQ request/reply pattern), so it satisfies the
 * port contract "drive ONE job to completion and return its result" exactly like
 * the in-process default. The crawl drain loop drives `addCrawlPage` per batch.
 *
 * Pass the host-owned Redis connection (options or ioredis instance) and inject
 * via `createEngine({ queue: new BullMqJobQueue(redis, { concurrency }) })`.
 *
 * NOTE on errors across the wire: BullMQ serializes a worker's thrown error to
 * its `.message` only, so the producer receives a plain `Error` — the original
 * error's class, `code`, `cause`, and custom properties do NOT survive the trip.
 * Do not branch on `instanceof` on the producer side; match on `.message`.
 */
export class BullMqJobQueue implements JobQueue {
  readonly concurrency?: number;
  private readonly waitTimeoutMs: number;
  private readonly scrapeQueue: Queue<ScrapeJobData, ScrapeUrlResult>;
  private readonly crawlQueue: Queue<CrawlPageJobData, CrawlPageJobData[]>;
  private readonly extractQueue: Queue<ExtractJobData, ExtractResult>;
  private readonly scrapeEvents: QueueEvents;
  private readonly crawlEvents: QueueEvents;
  private readonly extractEvents: QueueEvents;

  constructor(connection: QueueConnection, opts: BullMqJobQueueOptions = {}) {
    this.concurrency = opts.concurrency;
    this.waitTimeoutMs = opts.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const onError =
      opts.onError ??
      ((error: Error) => console.error("[adapters-bullmq] producer error:", error));

    // Queues: producer side, normal connection, bounded auto-removal on the Queue.
    const queueOptions = {
      connection: normalizeQueueConnection(connection),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
      ...(opts.prefix ? { prefix: opts.prefix } : {}),
    };
    // QueueEvents: blocking consumer — needs maxRetriesPerRequest:null.
    const eventsConnection = {
      connection: normalizeBlockingConnection(connection),
      ...(opts.prefix ? { prefix: opts.prefix } : {}),
    };

    // Each waitUntilFinished attaches one 'closing' listener to its Queue, so
    // size the ceiling to the drain width (+headroom) to avoid Node's
    // MaxListenersExceededWarning under concurrent crawls / scrape fan-out.
    const maxInFlight = (opts.concurrency ?? 1) + 16;

    this.scrapeQueue = this.wire(
      new Queue<ScrapeJobData, ScrapeUrlResult>(SCRAPE_QUEUE, queueOptions),
      maxInFlight,
      onError,
    );
    this.crawlQueue = this.wire(
      new Queue<CrawlPageJobData, CrawlPageJobData[]>(CRAWL_QUEUE, queueOptions),
      maxInFlight,
      onError,
    );
    this.extractQueue = this.wire(
      new Queue<ExtractJobData, ExtractResult>(EXTRACT_QUEUE, queueOptions),
      maxInFlight,
      onError,
    );
    this.scrapeEvents = this.wire(
      new QueueEvents(SCRAPE_QUEUE, eventsConnection),
      undefined,
      onError,
    );
    this.crawlEvents = this.wire(
      new QueueEvents(CRAWL_QUEUE, eventsConnection),
      undefined,
      onError,
    );
    this.extractEvents = this.wire(
      new QueueEvents(EXTRACT_QUEUE, eventsConnection),
      undefined,
      onError,
    );
  }

  /** Attach the error observer (always — BullMQ only forwards connection errors
   *  once a listener exists) and, for Queues, raise the listener ceiling so the
   *  per-job `waitUntilFinished` 'closing' listener can't trip Node's
   *  MaxListenersExceededWarning under concurrent crawls. */
  private wire<
    T extends {
      setMaxListeners(n: number): unknown;
      on(e: "error", fn: (err: Error) => void): unknown;
    },
  >(emitter: T, maxInFlight: number | undefined, onError: (error: Error) => void): T {
    if (maxInFlight !== undefined) emitter.setMaxListeners(maxInFlight);
    emitter.on("error", onError);
    return emitter;
  }

  async addScrape(data: ScrapeJobData): Promise<ScrapeUrlResult> {
    const job = await this.scrapeQueue.add(SCRAPE_JOB, data);
    return job.waitUntilFinished(this.scrapeEvents, this.waitTimeoutMs);
  }

  async addCrawlPage(data: CrawlPageJobData): Promise<CrawlPageJobData[]> {
    const job = await this.crawlQueue.add(CRAWL_JOB, data);
    return job.waitUntilFinished(this.crawlEvents, this.waitTimeoutMs);
  }

  async addExtract(data: ExtractJobData): Promise<ExtractResult> {
    const job = await this.extractQueue.add(EXTRACT_JOB, data);
    return job.waitUntilFinished(this.extractEvents, this.waitTimeoutMs);
  }

  /** Resolve when all producer Queues + QueueEvents are connected to Redis.
   *  Await before producing jobs if you need the producer ready up front. */
  async ready(): Promise<void> {
    await Promise.all([
      this.scrapeQueue.waitUntilReady(),
      this.crawlQueue.waitUntilReady(),
      this.extractQueue.waitUntilReady(),
      this.scrapeEvents.waitUntilReady(),
      this.crawlEvents.waitUntilReady(),
      this.extractEvents.waitUntilReady(),
    ]);
  }

  /** Close the producer-side Queues and QueueEvents. Uses `Promise.allSettled`
   *  so every entity is drained and all failures are reported (an `AggregateError`
   *  if more than one failed). Does NOT close a host-owned ioredis instance
   *  passed as the connection — the host owns its lifetime. */
  async close(): Promise<void> {
    const results = await Promise.allSettled([
      this.scrapeQueue.close(),
      this.crawlQueue.close(),
      this.extractQueue.close(),
      this.scrapeEvents.close(),
      this.crawlEvents.close(),
      this.extractEvents.close(),
    ]);
    const errs = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason as Error);
    if (errs.length === 1) throw errs[0]!;
    if (errs.length > 1) {
      throw new AggregateError(
        errs,
        `BullMqJobQueue.close: ${errs.length} of 6 entities failed to close`,
      );
    }
  }
}

/** Thin factory mirroring the core/pg/minio backend-factory convention. */
export function createBullMqJobQueue(
  connection: QueueConnection,
  opts?: BullMqJobQueueOptions,
): BullMqJobQueue {
  return new BullMqJobQueue(connection, opts);
}
