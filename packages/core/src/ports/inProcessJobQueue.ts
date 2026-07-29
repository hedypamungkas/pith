import type { ScrapeUrlResult } from "../scrape/scrapeUrlCore.js";
import type { ExtractResult } from "../extract/extractPure.js";
import type {
  JobQueue,
  ScrapeJobData,
  ExtractJobData,
} from "./corePorts.js";
import type { CrawlPageJobData } from "../crawl/types.js";

/** A scrape job processor — see {@link createScrapeProcessor}. */
export type ScrapeProcessor = (data: ScrapeJobData) => Promise<ScrapeUrlResult>;
/** A crawl-page job processor — see {@link createCrawlPageProcessor}. */
export type CrawlPageProcessor = (data: CrawlPageJobData) => Promise<CrawlPageJobData[]>;
/** An extract job processor — see {@link createExtractProcessor}. */
export type ExtractProcessor = (data: ExtractJobData) => Promise<ExtractResult>;

export interface InProcessJobQueueProcessors {
  scrape: ScrapeProcessor;
  crawlPage: CrawlPageProcessor;
  extract: ExtractProcessor;
}

/**
 * The default {@link JobQueue}: runs each processor inline in the calling event
 * loop — no network, no Redis, no extra concurrency. The engine's crawl drain
 * loop runs sequentially (`concurrency` is undefined ⇒ 1), so this is
 * behavior-identical to the original in-process crawl. `createEngine` builds it
 * from the same processors a BullMQ worker would run; pass `options.queue` to
 * override with a real runner.
 */
export class InProcessJobQueue implements JobQueue {
  // `concurrency` is intentionally absent — the drain loop reads
  // `queue.concurrency ?? 1`, so undefined means sequential (the default).
  constructor(private readonly processors: InProcessJobQueueProcessors) {}

  addScrape(data: ScrapeJobData): Promise<ScrapeUrlResult> {
    return this.processors.scrape(data);
  }

  addCrawlPage(data: CrawlPageJobData): Promise<CrawlPageJobData[]> {
    return this.processors.crawlPage(data);
  }

  addExtract(data: ExtractJobData): Promise<ExtractResult> {
    return this.processors.extract(data);
  }
}
