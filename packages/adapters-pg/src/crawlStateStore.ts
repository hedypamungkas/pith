import type {
  CrawlStateStore,
  CreateCrawlInput,
  CrawlStatus,
  DiscoveredPage,
  PageCounts,
  PageStatus,
  ResumablePausedPage,
  CrawlPageDetail,
} from "@use-pith/core";
import type { Queryable } from "./queryable.js";
import { toDate, toNumber } from "./util.js";

interface JobRow {
  root_url: string;
  status: CrawlStatus["status"];
  max_depth: number;
  max_pages: number;
  same_domain_only: boolean;
  include_patterns: string[] | null;
  exclude_patterns: string[] | null;
  ignore_robots_txt: boolean;
  api_key_id: number;
  auth_session_id: string | null;
}

interface PageRow {
  id: string | number;
  crawl_id: string;
  url: string;
  depth: number;
  status: PageStatus;
  attempt_count: string | number;
  last_error: string | null;
  request_id: string | null;
  discovered_at: unknown;
  completed_at: unknown;
}

interface CountRow {
  total: string | number;
  pending: string | number;
  succeeded: string | number;
  failed: string | number;
  paused: string | number;
}

/**
 * Postgres-backed {@link CrawlStateStore} — a faithful mirror of
 * {@link InMemoryCrawlStateStore} over the `crawl_jobs` / `crawl_pages`
 * tables. The state machine transitions are identical
 * (crawl_jobs: queued→running→{complete|partial|failed};
 * crawl_pages: pending→{success|failed|paused}, paused→pending), and the
 * load-bearing invariants are preserved:
 *
 *  - `insertDiscoveredPages` enforces `maxPages` + `(crawl_id,url)` dedup
 *    under a serialized critical section (`SELECT … FOR UPDATE` on the
 *    crawl_jobs row), with children inserted before the parent is marked
 *    success — a sibling finalizing at that instant still sees pending work.
 *  - `finalizeCrawlIfDone` treats paused pages as outstanding (no finalize),
 *    and maps the terminal status (complete / partial / failed) exactly.
 *  - resume/redelivery idempotency is the `getPageStatus` gate.
 */
export class PgCrawlStateStore implements CrawlStateStore {
  constructor(private readonly client: Queryable) {}

  async createCrawl(input: CreateCrawlInput): Promise<number> {
    return this.client.tx(async (q) => {
      await q.query(
        `INSERT INTO crawl_jobs
           (id, root_url, status, max_depth, max_pages, same_domain_only,
            include_patterns, exclude_patterns, ignore_robots_txt,
            api_key_id, auth_session_id)
         VALUES ($1, $2, 'queued', $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          input.id,
          input.rootUrl,
          input.maxDepth,
          input.maxPages,
          input.sameDomainOnly,
          input.includePatterns ?? null,
          input.excludePatterns ?? null,
          input.ignoreRobotsTxt,
          input.apiKeyId,
          input.authSessionId ?? null,
        ],
      );
      const { rows } = await q.query<{ id: string | number }>(
        `INSERT INTO crawl_pages (crawl_id, url, depth, status)
         VALUES ($1, $2, 0, 'pending')
         RETURNING id`,
        [input.id, input.rootUrl],
      );
      return toNumber(rows[0]!.id);
    });
  }

  async markCrawlRunning(crawlId: string): Promise<void> {
    await this.client.query(
      `UPDATE crawl_jobs SET status = 'running'
       WHERE id = $1 AND status = 'queued'`,
      [crawlId],
    );
  }

  async markPageSuccess(pageId: number, requestId: string): Promise<void> {
    await this.client.query(
      `UPDATE crawl_pages
         SET status = 'success', request_id = $2, completed_at = now()
       WHERE id = $1`,
      [pageId, requestId],
    );
  }

  async markPageFailed(
    pageId: number,
    requestId: string,
    lastError?: string,
  ): Promise<void> {
    await this.client.query(
      `UPDATE crawl_pages
         SET status = 'failed', request_id = $2, last_error = $3, completed_at = now()
       WHERE id = $1`,
      [pageId, requestId, lastError ?? null],
    );
  }

  async markPagePaused(
    pageId: number,
    requestId: string,
    reason: string,
  ): Promise<void> {
    // completed_at stays NULL — paused is not terminal.
    await this.client.query(
      `UPDATE crawl_pages
         SET status = 'paused', request_id = $2, last_error = $3
       WHERE id = $1`,
      [pageId, requestId, reason],
    );
  }

  async markPagePending(pageId: number): Promise<void> {
    await this.client.query(
      `UPDATE crawl_pages SET status = 'pending', last_error = NULL WHERE id = $1`,
      [pageId],
    );
  }

  async incrementPageAttempt(pageId: number): Promise<void> {
    await this.client.query(
      `UPDATE crawl_pages SET attempt_count = attempt_count + 1 WHERE id = $1`,
      [pageId],
    );
  }

  async getPageStatus(pageId: number): Promise<PageStatus | null> {
    const { rows } = await this.client.query<{ status: PageStatus }>(
      `SELECT status FROM crawl_pages WHERE id = $1`,
      [pageId],
    );
    return rows[0]?.status ?? null;
  }

  private async countPages(
    q: Queryable,
    crawlId: string,
  ): Promise<PageCounts> {
    const { rows } = await q.query<CountRow>(
      `SELECT
         count(*) AS total,
         count(*) FILTER (WHERE status = 'pending') AS pending,
         count(*) FILTER (WHERE status = 'success') AS succeeded,
         count(*) FILTER (WHERE status = 'failed') AS failed,
         count(*) FILTER (WHERE status = 'paused') AS paused
       FROM crawl_pages WHERE crawl_id = $1`,
      [crawlId],
    );
    const r = rows[0];
    if (!r) return { total: 0, pending: 0, succeeded: 0, failed: 0, paused: 0 };
    return {
      total: toNumber(r.total),
      pending: toNumber(r.pending),
      succeeded: toNumber(r.succeeded),
      failed: toNumber(r.failed),
      paused: toNumber(r.paused),
    };
  }

  async getPageCounts(crawlId: string): Promise<PageCounts> {
    return this.countPages(this.client, crawlId);
  }

  async insertDiscoveredPages(
    crawlId: string,
    maxPages: number,
    pages: Array<{ url: string; depth: number }>,
  ): Promise<DiscoveredPage[]> {
    if (pages.length === 0) return [];
    return this.client.tx(async (q) => {
      // Serialize concurrent inserts for this crawl (the FOR UPDATE row lock).
      await q.query(`SELECT id FROM crawl_jobs WHERE id = $1 FOR UPDATE`, [
        crawlId,
      ]);
      const { rows: existing } = await q.query<{ url: string }>(
        `SELECT url FROM crawl_pages WHERE crawl_id = $1`,
        [crawlId],
      );
      const seen = new Set(existing.map((r) => r.url));
      let slots = Math.max(0, maxPages - existing.length);
      const toInsert: Array<{ url: string; depth: number }> = [];
      for (const pg of pages) {
        if (slots <= 0) break;
        if (seen.has(pg.url)) continue; // ON CONFLICT (crawl_id, url) DO NOTHING
        seen.add(pg.url);
        toInsert.push(pg);
        slots -= 1;
      }
      if (toInsert.length === 0) return [];

      // Multi-row VALUES with explicit params (no array binding) so the
      // statement is identical on pg and PGlite. ON CONFLICT is the final
      // safety net for the (crawl_id, url) uniqueness.
      const params: unknown[] = [crawlId];
      const tuples = toInsert
        .map((pg) => {
          const base = params.length;
          params.push(pg.url, pg.depth);
          return `($1, $${base + 1}, $${base + 2}, 'pending')`;
        })
        .join(", ");
      const { rows: inserted } = await q.query<{ id: string | number; url: string }>(
        `INSERT INTO crawl_pages (crawl_id, url, depth, status)
         VALUES ${tuples}
         ON CONFLICT (crawl_id, url) DO NOTHING
         RETURNING id, url`,
        params,
      );
      return inserted.map((r) => ({ id: toNumber(r.id), url: r.url }));
    });
  }

  async finalizeCrawlIfDone(crawlId: string): Promise<boolean> {
    return this.client.tx(async (q) => {
      // Lock the job so concurrent finalizers can't both read zero-pending.
      const { rows } = await q.query<{ id: string }>(
        `SELECT id FROM crawl_jobs WHERE id = $1 FOR UPDATE`,
        [crawlId],
      );
      if (rows.length === 0) return false;
      const counts = await this.countPages(q, crawlId);
      if (counts.pending > 0 || counts.paused > 0) return false;
      const status =
        counts.failed === 0
          ? "complete"
          : counts.succeeded > 0
            ? "partial"
            : "failed";
      await q.query(
        `UPDATE crawl_jobs SET status = $2
         WHERE id = $1 AND status IN ('queued', 'running')`,
        [crawlId, status],
      );
      return true;
    });
  }

  async getCrawlStatus(crawlId: string): Promise<CrawlStatus | null> {
    const { rows } = await this.client.query<JobRow>(
      `SELECT root_url, status, max_depth, max_pages, same_domain_only,
              include_patterns, exclude_patterns, ignore_robots_txt,
              api_key_id, auth_session_id
       FROM crawl_jobs WHERE id = $1`,
      [crawlId],
    );
    const j = rows[0];
    if (!j) return null;
    const c = await this.getPageCounts(crawlId);
    return {
      crawlId,
      rootUrl: j.root_url,
      status: j.status,
      pagesTotal: c.total,
      pagesSucceeded: c.succeeded,
      pagesFailed: c.failed,
      pagesPending: c.pending,
      pagesPaused: c.paused,
    };
  }

  async listPausedPages(authSessionId: string): Promise<ResumablePausedPage[]> {
    const { rows } = await this.client.query<
      PageRow & {
        api_key_id: number;
        max_depth: number;
        max_pages: number;
        same_domain_only: boolean;
        include_patterns: string[] | null;
        exclude_patterns: string[] | null;
        ignore_robots_txt: boolean;
      }
    >(
      `SELECT p.id, p.crawl_id, p.url, p.depth, p.request_id,
              j.api_key_id, j.max_depth, j.max_pages, j.same_domain_only,
              j.include_patterns, j.exclude_patterns, j.ignore_robots_txt
       FROM crawl_pages p
       JOIN crawl_jobs j ON p.crawl_id = j.id
       WHERE p.status = 'paused' AND j.auth_session_id = $1`,
      [authSessionId],
    );
    return rows.map((p) => ({
      crawlId: p.crawl_id,
      pageId: toNumber(p.id),
      url: p.url,
      depth: p.depth,
      apiKeyId: p.api_key_id,
      maxDepth: p.max_depth,
      maxPages: p.max_pages,
      sameDomainOnly: p.same_domain_only,
      includePatterns: p.include_patterns,
      excludePatterns: p.exclude_patterns,
      ignoreRobotsTxt: p.ignore_robots_txt,
    }));
  }

  async listPages(crawlId: string): Promise<CrawlPageDetail[]> {
    const { rows } = await this.client.query<PageRow>(
      `SELECT id, crawl_id, url, depth, status, attempt_count, last_error,
              request_id, discovered_at, completed_at
       FROM crawl_pages WHERE crawl_id = $1
       ORDER BY discovered_at`,
      [crawlId],
    );
    return rows.map((p) => ({
      id: toNumber(p.id),
      url: p.url,
      depth: p.depth,
      status: p.status,
      attemptCount: toNumber(p.attempt_count),
      lastError: p.last_error,
      requestId: p.request_id,
      discoveredAt: toDate(p.discovered_at),
      completedAt: p.completed_at == null ? null : toDate(p.completed_at),
    }));
  }
}

/** Thin factory mirroring core's backend factories. */
export function createPgCrawlStateStore(
  client: Queryable,
): PgCrawlStateStore {
  return new PgCrawlStateStore(client);
}
