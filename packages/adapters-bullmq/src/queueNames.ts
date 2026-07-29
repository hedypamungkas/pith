import type { DefaultJobOptions } from "bullmq";

/**
 * The three BullMQ queue names the producer ({@link BullMqJobQueue}) and the
 * workers (`runWorkers`) MUST agree on. Each job type has its own queue so a
 * worker process runs one processor per queue (BullMQ binds one Worker to one
 * queue), and so scrape / crawl-page / extract work can be scaled independently.
 */
export const SCRAPE_QUEUE = "pith-scrape";
export const CRAWL_QUEUE = "pith-crawl";
export const EXTRACT_QUEUE = "pith-extract";

/** The job name within each single-purpose queue (BullMQ requires a name; the
 *  worker processes every job in its queue regardless of name). */
export const SCRAPE_JOB = "scrape";
export const CRAWL_JOB = "crawlPage";
export const EXTRACT_JOB = "extract";

/**
 * Bounded auto-removal applied to the **Queue's** `defaultJobOptions`.
 *
 * CRITICAL: this lives on the Queue (producer) side, as a BOUNDED count — never
 * on the Worker and never as bare `true`. Setting `removeOnComplete` on the
 * Worker is broken (BullMQ #2620), and a bare `true` races
 * `Job.waitUntilFinished`: the job is removed before the producer reads its
 * `returnvalue`, throwing "job not found" (BullMQ #85). A bounded count keeps
 * each completed job's returnvalue readable long enough for the producer to
 * fetch it, while still capping steady-state Redis growth (scrape results —
 * 100s of KB of html each — are stored transiently as returnvalues until
 * reaped; crawl-page/extract returnvalues are small). Frozen so a host can't
 * mutate it back to bare `true` at runtime.
 */
export const DEFAULT_JOB_OPTIONS: Readonly<DefaultJobOptions> = Object.freeze({
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
});
