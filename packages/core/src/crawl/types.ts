import type { StorageState } from "../types.js";

export type PageStatus = "pending" | "success" | "failed" | "paused";

export interface CrawlBounds {
  maxDepth: number;
  maxPages: number;
  sameDomainOnly: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
  ignoreRobotsTxt: boolean;
}

export interface CreateCrawlInput extends CrawlBounds {
  id: string;
  rootUrl: string;
  apiKeyId: number;
  authSessionId?: string;
}

export interface PageCounts {
  total: number;
  pending: number;
  succeeded: number;
  failed: number;
  paused: number;
}

export type CrawlJobStatus = "queued" | "running" | "complete" | "partial" | "failed";

export interface CrawlStatus {
  crawlId: string;
  rootUrl: string;
  status: CrawlJobStatus;
  pagesTotal: number;
  pagesSucceeded: number;
  pagesFailed: number;
  pagesPending: number;
  pagesPaused: number;
}

export interface DiscoveredPage {
  id: number;
  url: string;
}

export interface ResumablePausedPage {
  crawlId: string;
  pageId: number;
  url: string;
  depth: number;
  apiKeyId: number;
  maxDepth: number;
  maxPages: number;
  sameDomainOnly: boolean;
  includePatterns: string[] | null;
  excludePatterns: string[] | null;
  ignoreRobotsTxt: boolean;
}

export interface CrawlPageDetail {
  id: number;
  url: string;
  depth: number;
  status: PageStatus;
  attemptCount: number;
  lastError: string | null;
  requestId: string | null;
  discoveredAt: Date;
  completedAt: Date | null;
}

/** The per-page unit of work the crawl driver processes. Mirrors the source
 *  project's BullMQ job payload, minus the queue-only fields. */
export interface CrawlPageJobData extends CrawlBounds {
  crawlId: string;
  apiKeyId: number;
  authSessionId?: string;
  pageId: number;
  url: string;
  depth: number;
  storageState?: StorageState;
}
