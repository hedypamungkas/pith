/**
 * @use-pith/adapters-bullmq — BullMQ/Redis adapter for the Pith `JobQueue` port.
 *
 * A distributed job runner for `@use-pith/core`: a `BullMqJobQueue` (producer)
 * enqueues scrape / crawl-page / extract jobs on Redis and awaits each worker's
 * result, and `runWorkers` (the worker-process entrypoint) drains them with the
 * SAME processor factories the in-process engine uses. Inject the producer via
 * the port the engine already consumes:
 *
 *   import Redis from "ioredis";
 *   import { createEngine, createScrapeProcessor, createCrawlPageProcessor, createExtractProcessor } from "@use-pith/core";
 *   import { BullMqJobQueue, runWorkers } from "@use-pith/adapters-bullmq";
 *
 *   const redis = new Redis(process.env.REDIS_URL); // host-owned
 *   // engine process: produce jobs through the queue
 *   const pith = createEngine({ queue: new BullMqJobQueue(redis, { concurrency: 8 }) });
 *   // worker process(es): consume jobs with the real-deps processors
 *   const workers = runWorkers(redis, {
 *     scrape: processScrape, crawlPage: processCrawlPage, extract: processExtract, concurrency: 8,
 *   });
 *
 * `bullmq` + `ioredis` are dependencies of THIS package only — core never imports
 * them (enforced by the core smoke gate `no-infra-on-import`). `@use-pith/core`
 * is a peer.
 */

export {
  SCRAPE_QUEUE,
  CRAWL_QUEUE,
  EXTRACT_QUEUE,
  SCRAPE_JOB,
  CRAWL_JOB,
  EXTRACT_JOB,
  DEFAULT_JOB_OPTIONS,
} from "./queueNames.js";

export type { QueueConnection } from "./connection.js";
export { normalizeQueueConnection, normalizeBlockingConnection } from "./connection.js";

export { BullMqJobQueue, createBullMqJobQueue } from "./bullMqJobQueue.js";
export type { BullMqJobQueueOptions } from "./bullMqJobQueue.js";

export { runWorkers, createWorkers } from "./runWorkers.js";
export type { RunWorkersOptions, WorkerHandle } from "./runWorkers.js";
