import { z } from "zod";
import type { Engine } from "../engine.js";
import type { CrawlStatus } from "../crawl/types.js";

export const crawlRequestSchema = z.object({
  url: z.string().url(),
  maxDepth: z.number().int().min(0).max(10).default(2),
  maxPages: z.number().int().min(1).max(500).default(50),
  sameDomainOnly: z.boolean().default(true),
  includePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
  ignoreRobotsTxt: z.boolean().default(false),
});

export type CrawlHandlerResult =
  | { crawlId: string }
  | { error: string; errorKind: "client" };

/** Kicks off a crawl and returns its id immediately; the crawl runs to
 *  completion in the background. Poll status via handleGetCrawlStatus. */
export async function handleCrawlRequest(
  input: unknown,
  engine: Engine,
): Promise<CrawlHandlerResult> {
  const parsed = crawlRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.message, errorKind: "client" };
  }
  const { url, maxDepth, maxPages, sameDomainOnly, includePatterns, excludePatterns, ignoreRobotsTxt } =
    parsed.data;
  const handle = await engine.crawl(url, {
    maxDepth,
    maxPages,
    sameDomainOnly,
    includePatterns,
    excludePatterns,
    ignoreRobotsTxt,
  });
  // Drive the crawl to completion in the background; the caller polls by crawlId.
  void handle.wait().catch(() => {
    /* background crawl failure surfaces via the crawl status, not the kickoff */
  });
  return { crawlId: handle.crawlId };
}

export async function handleGetCrawlStatus(
  crawlId: string,
  engine: Engine,
): Promise<CrawlStatus | null> {
  return engine.ports.crawlStateStore.getCrawlStatus(crawlId);
}
