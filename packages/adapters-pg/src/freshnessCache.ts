import type {
  FreshnessCache,
  FreshnessRecord,
  RecordFreshnessInput,
  DueUrl,
} from "@use-pith/core";
import type { ScrapeUrlResult } from "@use-pith/core";
import type { Queryable } from "./queryable.js";
import { toDate } from "./util.js";

interface FreshnessRow {
  url: string;
  watched_tier: string;
  watched_tier_max_staleness_seconds: string | number;
  watched_tier_proactive_recrawl: boolean;
  crawled_at: unknown;
  next_due_at: unknown;
  content: ScrapeUrlResult;
}

/**
 * Postgres-backed {@link FreshnessCache} over the `freshness` table.
 *
 * {@link record} is the `LEAST() + CASE` monotonic-tightening upsert the port
 * contract names (`corePorts.ts`): the watched tier is adopted ONLY when the
 * incoming `maxStalenessSeconds` is STRICTER than the stored one, so two
 * concurrent scrapes of a new URL can't let a last-write-wins downgrade — the
 * SQL equivalent of the in-process `LEAST() + CASE` referenced by
 * {@link InMemoryFreshnessCache}. The atomic upsert needs no per-URL mutex
 * (the row lock is implicit), so `record` runs without a `tx()`.
 *
 * `content` holds the full `ScrapeUrlResult` as JSONB (inline, matching the
 * in-memory default); a later `adapters-minio` offloads it to an object store.
 */
export class PgFreshnessCache implements FreshnessCache {
  constructor(private readonly client: Queryable) {}

  async tryGet(url: string): Promise<FreshnessRecord | null> {
    const { rows } = await this.client.query<FreshnessRow>(
      `SELECT url, watched_tier, watched_tier_max_staleness_seconds,
              watched_tier_proactive_recrawl, crawled_at, next_due_at, content
       FROM freshness WHERE url = $1`,
      [url],
    );
    const r = rows[0];
    return r ? this.toRecord(r) : null;
  }

  async record(input: RecordFreshnessInput): Promise<void> {
    // Precompute the new-row next_due_at (crawledAt + requested max). On
    // conflict, next_due_at is recomputed from the resolved (tighter) max via
    // make_interval over the columns — no param is referenced twice.
    const nextDueAt = new Date(
      input.crawledAt.getTime() + input.requestedTierMaxStalenessSeconds * 1000,
    );
    await this.client.query(
      `INSERT INTO freshness
         (url, watched_tier, watched_tier_max_staleness_seconds,
          watched_tier_proactive_recrawl, crawled_at, next_due_at, content)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (url) DO UPDATE SET
         watched_tier = CASE
           WHEN EXCLUDED.watched_tier_max_staleness_seconds
                < freshness.watched_tier_max_staleness_seconds
           THEN EXCLUDED.watched_tier ELSE freshness.watched_tier END,
         watched_tier_max_staleness_seconds =
           LEAST(freshness.watched_tier_max_staleness_seconds,
                 EXCLUDED.watched_tier_max_staleness_seconds),
         watched_tier_proactive_recrawl = CASE
           WHEN EXCLUDED.watched_tier_max_staleness_seconds
                < freshness.watched_tier_max_staleness_seconds
           THEN EXCLUDED.watched_tier_proactive_recrawl
           ELSE freshness.watched_tier_proactive_recrawl END,
         crawled_at = EXCLUDED.crawled_at,
         next_due_at = EXCLUDED.crawled_at
           + make_interval(secs => LEAST(
               freshness.watched_tier_max_staleness_seconds,
               EXCLUDED.watched_tier_max_staleness_seconds)::float8),
         content = EXCLUDED.content`,
      [
        input.url,
        input.requestedTier,
        input.requestedTierMaxStalenessSeconds,
        input.requestedTierProactiveRecrawl,
        input.crawledAt,
        nextDueAt,
        JSON.stringify(input.content),
      ],
    );
  }

  async listDue(now: Date): Promise<DueUrl[]> {
    const { rows } = await this.client.query<{
      url: string;
      watched_tier: string;
    }>(
      `SELECT url, watched_tier FROM freshness
       WHERE watched_tier_proactive_recrawl AND next_due_at <= $1`,
      [now],
    );
    return rows.map((r) => ({ url: r.url, watchedTier: r.watched_tier }));
  }

  async delete(url: string): Promise<boolean> {
    const { rows } = await this.client.query<{ url: string }>(
      `DELETE FROM freshness WHERE url = $1 RETURNING url`,
      [url],
    );
    return rows.length > 0;
  }

  private toRecord(r: FreshnessRow): FreshnessRecord {
    const maxStaleness = Number(r.watched_tier_max_staleness_seconds);
    return {
      url: r.url,
      watchedTier: r.watched_tier,
      watchedTierMaxStalenessSeconds: maxStaleness,
      watchedTierProactiveRecrawl: r.watched_tier_proactive_recrawl,
      crawledAt: toDate(r.crawled_at),
      nextDueAt: toDate(r.next_due_at),
      content: r.content,
    };
  }
}

/** Thin factory mirroring core's backend factories. */
export function createPgFreshnessCache(client: Queryable): PgFreshnessCache {
  return new PgFreshnessCache(client);
}
