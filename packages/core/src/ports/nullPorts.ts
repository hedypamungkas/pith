import type { CorePorts, CrawlStateStore } from "./corePorts.js";
import type { ScrapeAttempt } from "../pricing.js";
import type {
  CreateCrawlInput,
  CrawlPageDetail,
  CrawlStatus,
  DiscoveredPage,
  PageCounts,
  PageStatus,
  ResumablePausedPage,
} from "../crawl/types.js";

/**
 * No-op / in-memory defaults for every port. `createEngine()` with no arguments
 * uses exactly these, so the engine runs with zero infrastructure out of the
 * box. The in-memory stores here are intentionally minimal and correct; their
 * full semantics (serialized maxPages enforcement, LRU caps, TTL expiry, worker
 * resume) are fleshed out in spin-off step 5 as engine tests demand them.
 */

class NoopCostRecorder {
  recordAttempts(_attempts: ScrapeAttempt[]): void {
    /* records nothing */
  }
  recordCostEvent(_event: unknown): void {
    /* records nothing */
  }
  hasCostEventForRequest(_requestId: string): boolean {
    // Idempotency sees a fresh request when nothing is recorded.
    return false;
  }
  getCostCentsForRequest(_requestId: string): number {
    return 0;
  }
}

class InMemorySnapshotStore {
  private readonly store = new Map<string, unknown>();
  capture(snapshot: unknown): void {
    if (snapshot && typeof snapshot === "object" && "requestId" in snapshot) {
      const requestId = (snapshot as { requestId: string }).requestId;
      this.store.set(requestId, snapshot);
    }
  }
  load(requestId: string): unknown {
    return this.store.get(requestId);
  }
}

interface CrawlJobRow {
  id: string;
  rootUrl: string;
  status: CrawlStatus["status"];
  maxDepth: number;
  maxPages: number;
  sameDomainOnly: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
  ignoreRobotsTxt: boolean;
  apiKeyId: number;
  authSessionId?: string;
}

interface CrawlPageRow {
  id: number;
  crawlId: string;
  url: string;
  depth: number;
  status: PageStatus;
  attemptCount: number;
  lastError: string | null;
  requestId: string | null;
  discoveredAt: Date;
  completedAt: Date | null;
}

/** Full in-memory mirror of the source project's Postgres crawl state machine:
 *  crawl_jobs.status (queued→running→{complete|partial|failed}) and
 *  crawl_pages.status (pending→{success|failed|paused}, paused→pending).
 *  insertDiscoveredPages enforces maxPages + (crawl_id,url) dedup under a
 *  serialized critical section — the in-process equivalent of
 *  SELECT...FOR UPDATE + ON CONFLICT DO NOTHING. */
class InMemoryCrawlStateStore implements CrawlStateStore {
  private readonly jobs = new Map<string, CrawlJobRow>();
  private readonly pages = new Map<number, CrawlPageRow>();
  private nextId = 1;
  private readonly insertLocks = new Map<string, Promise<void>>();

  async createCrawl(input: CreateCrawlInput): Promise<number> {
    const job: CrawlJobRow = {
      id: input.id,
      rootUrl: input.rootUrl,
      status: "queued",
      maxDepth: input.maxDepth,
      maxPages: input.maxPages,
      sameDomainOnly: input.sameDomainOnly,
      includePatterns: input.includePatterns,
      excludePatterns: input.excludePatterns,
      ignoreRobotsTxt: input.ignoreRobotsTxt,
      apiKeyId: input.apiKeyId,
      authSessionId: input.authSessionId,
    };
    this.jobs.set(input.id, job);
    const rootPageId = this.nextId++;
    this.pages.set(rootPageId, {
      id: rootPageId,
      crawlId: input.id,
      url: input.rootUrl,
      depth: 0,
      status: "pending",
      attemptCount: 0,
      lastError: null,
      requestId: null,
      discoveredAt: new Date(),
      completedAt: null,
    });
    return rootPageId;
  }

  async markCrawlRunning(crawlId: string): Promise<void> {
    const j = this.jobs.get(crawlId);
    if (j && j.status === "queued") j.status = "running";
  }

  async markPageSuccess(pageId: number, requestId: string): Promise<void> {
    const p = this.pages.get(pageId);
    if (p) {
      p.status = "success";
      p.requestId = requestId;
      p.completedAt = new Date();
    }
  }

  async markPageFailed(
    pageId: number,
    requestId: string,
    lastError?: string,
  ): Promise<void> {
    const p = this.pages.get(pageId);
    if (p) {
      p.status = "failed";
      p.requestId = requestId;
      p.lastError = lastError ?? null;
      p.completedAt = new Date();
    }
  }

  async markPagePaused(
    pageId: number,
    requestId: string,
    reason: string,
  ): Promise<void> {
    const p = this.pages.get(pageId);
    if (p) {
      p.status = "paused";
      p.requestId = requestId;
      p.lastError = reason;
      // completedAt stays null — paused is not terminal.
    }
  }

  async markPagePending(pageId: number): Promise<void> {
    const p = this.pages.get(pageId);
    if (p) {
      p.status = "pending";
      p.lastError = null;
    }
  }

  async incrementPageAttempt(pageId: number): Promise<void> {
    const p = this.pages.get(pageId);
    if (p) p.attemptCount += 1;
  }

  async getPageStatus(pageId: number): Promise<PageStatus | null> {
    return this.pages.get(pageId)?.status ?? null;
  }

  async getPageCounts(crawlId: string): Promise<PageCounts> {
    const cps = [...this.pages.values()].filter((p) => p.crawlId === crawlId);
    return {
      total: cps.length,
      pending: cps.filter((p) => p.status === "pending").length,
      succeeded: cps.filter((p) => p.status === "success").length,
      failed: cps.filter((p) => p.status === "failed").length,
      paused: cps.filter((p) => p.status === "paused").length,
    };
  }

  async insertDiscoveredPages(
    crawlId: string,
    maxPages: number,
    pages: Array<{ url: string; depth: number }>,
  ): Promise<DiscoveredPage[]> {
    if (pages.length === 0) return [];
    // Serialize concurrent inserts for the same crawl (the FOR UPDATE row lock).
    const prev = this.insertLocks.get(crawlId) ?? Promise.resolve();
    let release!: () => void;
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.insertLocks.set(crawlId, prev.then(() => lock));
    await prev;
    try {
      const existing = [...this.pages.values()].filter((p) => p.crawlId === crawlId);
      const seen = new Set(existing.map((p) => p.url));
      let slots = Math.max(0, maxPages - existing.length);
      const inserted: DiscoveredPage[] = [];
      for (const pg of pages) {
        if (slots <= 0) break;
        if (seen.has(pg.url)) continue; // ON CONFLICT (crawl_id, url) DO NOTHING
        const id = this.nextId++;
        this.pages.set(id, {
          id,
          crawlId,
          url: pg.url,
          depth: pg.depth,
          status: "pending",
          attemptCount: 0,
          lastError: null,
          requestId: null,
          discoveredAt: new Date(),
          completedAt: null,
        });
        seen.add(pg.url);
        slots -= 1;
        inserted.push({ id, url: pg.url });
      }
      return inserted;
    } finally {
      release();
    }
  }

  async finalizeCrawlIfDone(crawlId: string): Promise<boolean> {
    const j = this.jobs.get(crawlId);
    if (!j) return false;
    const c = await this.getPageCounts(crawlId);
    if (c.pending > 0 || c.paused > 0) return false; // paused treated as outstanding
    j.status = c.failed === 0 ? "complete" : c.succeeded > 0 ? "partial" : "failed";
    return true;
  }

  async getCrawlStatus(crawlId: string): Promise<CrawlStatus | null> {
    const j = this.jobs.get(crawlId);
    if (!j) return null;
    const c = await this.getPageCounts(crawlId);
    return {
      crawlId,
      rootUrl: j.rootUrl,
      status: j.status,
      pagesTotal: c.total,
      pagesSucceeded: c.succeeded,
      pagesFailed: c.failed,
      pagesPending: c.pending,
      pagesPaused: c.paused,
    };
  }

  async listPausedPages(authSessionId: string): Promise<ResumablePausedPage[]> {
    const out: ResumablePausedPage[] = [];
    for (const page of this.pages.values()) {
      if (page.status !== "paused") continue;
      const j = this.jobs.get(page.crawlId);
      if (!j || j.authSessionId !== authSessionId) continue;
      out.push({
        crawlId: page.crawlId,
        pageId: page.id,
        url: page.url,
        depth: page.depth,
        apiKeyId: j.apiKeyId,
        maxDepth: j.maxDepth,
        maxPages: j.maxPages,
        sameDomainOnly: j.sameDomainOnly,
        includePatterns: j.includePatterns ?? null,
        excludePatterns: j.excludePatterns ?? null,
        ignoreRobotsTxt: j.ignoreRobotsTxt,
      });
    }
    return out;
  }

  async listPages(crawlId: string): Promise<CrawlPageDetail[]> {
    return [...this.pages.values()]
      .filter((p) => p.crawlId === crawlId)
      .sort((a, b) => a.discoveredAt.getTime() - b.discoveredAt.getTime())
      .map((p) => ({
        id: p.id,
        url: p.url,
        depth: p.depth,
        status: p.status,
        attemptCount: p.attemptCount,
        lastError: p.lastError,
        requestId: p.requestId,
        discoveredAt: p.discoveredAt,
        completedAt: p.completedAt,
      }));
  }
}

class InMemoryContentStore {
  private readonly blobs = new Map<string, Uint8Array | string>();
  put(key: string, body: Uint8Array | string): void {
    this.blobs.set(key, body);
  }
  get(key: string): Uint8Array | string | undefined {
    return this.blobs.get(key);
  }
  list(prefix: string): string[] {
    return [...this.blobs.keys()].filter((k) => k.startsWith(prefix));
  }
  delete(key: string): void {
    this.blobs.delete(key);
  }
}

class InProcessJobDriver {
  addScrape(payload: unknown): unknown {
    return payload;
  }
  addCrawlPage(payload: unknown): unknown {
    return payload;
  }
  addExtract(payload: unknown): unknown {
    return payload;
  }
  wait(payload: unknown): unknown {
    return payload;
  }
}

class AllowAllRobotsResolver {
  isAllowed(_url: string): boolean {
    // Placeholder default: the real robotsGuard (with SSRF-validated fetch +
    // spec-compliant fail-open) ports in step 2 and becomes the default.
    return true;
  }
}

class InMemoryFreshnessCache {
  private readonly cache = new Map<string, unknown>();
  tryGet(url: string): unknown {
    return this.cache.get(url) ?? null;
  }
  record(input: unknown): void {
    if (input && typeof input === "object" && "url" in input) {
      this.cache.set((input as { url: string }).url, input);
    }
  }
  listDue(): unknown[] {
    return [];
  }
}

export function createNullPorts(): CorePorts {
  return {
    costRecorder: new NoopCostRecorder(),
    snapshotStore: new InMemorySnapshotStore(),
    crawlStateStore: new InMemoryCrawlStateStore(),
    contentStore: new InMemoryContentStore(),
    queue: new InProcessJobDriver(),
    robotsResolver: new AllowAllRobotsResolver(),
    freshnessCache: new InMemoryFreshnessCache(),
    clock: () => new Date(),
  };
}
