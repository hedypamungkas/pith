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

export interface BullMqJobQueueOptions {
  /** The crawl drain loop's batch width — set to match the worker `concurrency`
   *  so the drain keeps the workers fed (the engine reads this at
   *  `pureCrawler.drainBatchSize`). Omit for sequential (undefined ⇒ 1).
   *  Scrape/extract ignore it (single awaits). */
  concurrency?: number;
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
 */
export class BullMqJobQueue implements JobQueue {
  readonly concurrency?: number;
  private readonly scrapeQueue: Queue<ScrapeJobData, ScrapeUrlResult>;
  private readonly crawlQueue: Queue<CrawlPageJobData, CrawlPageJobData[]>;
  private readonly extractQueue: Queue<ExtractJobData, ExtractResult>;
  private readonly scrapeEvents: QueueEvents;
  private readonly crawlEvents: QueueEvents;
  private readonly extractEvents: QueueEvents;

  constructor(connection: QueueConnection, opts: BullMqJobQueueOptions = {}) {
    this.concurrency = opts.concurrency;
    // Queues: producer side, normal connection, bounded auto-removal on the Queue.
    const queueOpts = { connection: normalizeQueueConnection(connection) };
    const queueOptions = { ...queueOpts, defaultJobOptions: DEFAULT_JOB_OPTIONS };
    this.scrapeQueue = new Queue<ScrapeJobData, ScrapeUrlResult>(
      SCRAPE_QUEUE,
      queueOptions,
    );
    this.crawlQueue = new Queue<CrawlPageJobData, CrawlPageJobData[]>(
      CRAWL_QUEUE,
      queueOptions,
    );
    this.extractQueue = new Queue<ExtractJobData, ExtractResult>(
      EXTRACT_QUEUE,
      queueOptions,
    );
    // QueueEvents: blocking consumer — needs maxRetriesPerRequest:null.
    const eventsConnection = { connection: normalizeBlockingConnection(connection) };
    this.scrapeEvents = new QueueEvents(SCRAPE_QUEUE, eventsConnection);
    this.crawlEvents = new QueueEvents(CRAWL_QUEUE, eventsConnection);
    this.extractEvents = new QueueEvents(EXTRACT_QUEUE, eventsConnection);
  }

  async addScrape(data: ScrapeJobData): Promise<ScrapeUrlResult> {
    const job = await this.scrapeQueue.add(SCRAPE_JOB, data);
    return job.waitUntilFinished(this.scrapeEvents);
  }

  async addCrawlPage(data: CrawlPageJobData): Promise<CrawlPageJobData[]> {
    const job = await this.crawlQueue.add(CRAWL_JOB, data);
    return job.waitUntilFinished(this.crawlEvents);
  }

  async addExtract(data: ExtractJobData): Promise<ExtractResult> {
    const job = await this.extractQueue.add(EXTRACT_JOB, data);
    return job.waitUntilFinished(this.extractEvents);
  }

  /** Close the producer-side Queues and QueueEvents. Does NOT close a host-owned
   *  ioredis instance passed by connection options — the host owns its lifetime. */
  async close(): Promise<void> {
    await Promise.all([
      this.scrapeQueue.close(),
      this.crawlQueue.close(),
      this.extractQueue.close(),
      this.scrapeEvents.close(),
      this.crawlEvents.close(),
      this.extractEvents.close(),
    ]);
  }
}

/** Thin factory mirroring the core/pg/minio backend-factory convention. */
export function createBullMqJobQueue(
  connection: QueueConnection,
  opts?: BullMqJobQueueOptions,
): BullMqJobQueue {
  return new BullMqJobQueue(connection, opts);
}
