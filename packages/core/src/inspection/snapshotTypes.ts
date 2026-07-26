import type { Tier } from "../pricing.js";

/**
 * Pure snapshot metadata types, decoupled from the (host-side) DB repository
 * that persists them. The OSS core owns these types so replay + inspection
 * work without a database; the prod project's `requestSnapshotRepository`
 * (Postgres-backed) is an optional adapter.
 */
export type SnapshotOperation = "scrape" | "extract" | "crawl_page";

export interface RequestSnapshot {
  requestId: string;
  apiKeyId: number;
  operation: SnapshotOperation;
  url: string;
  /** The request's input parameters — what a replay re-runs against. */
  input: Record<string, unknown>;
  tierUsed: Tier | null;
  statusCode: number | null;
  finalUrl: string | null;
  fetchedAt: string | null;
  attempts: unknown[] | null;
  objectKey: string;
  /** Extract only: the stored structured LLM output. Null for scrape/crawl_page. */
  extractionResult: Record<string, unknown> | null;
  createdAt: Date;
}
