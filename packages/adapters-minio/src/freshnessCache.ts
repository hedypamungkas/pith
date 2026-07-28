import type {
  FreshnessCache,
  FreshnessRecord,
  RecordFreshnessInput,
  DueUrl,
} from "@use-pith/core";
import type { ScrapeUrlResult } from "@use-pith/core";
import type { Queryable } from "@use-pith/adapters-pg";
import type { BlobStore } from "./blobStore.js";
import { freshnessObjectKey, toDate } from "./util.js";

interface FreshnessMetaRow {
  url: string;
  watched_tier: string;
  watched_tier_max_staleness_seconds: string | number;
  watched_tier_proactive_recrawl: boolean;
  crawled_at: unknown;
  next_due_at: unknown;
  content_object_key: string;
}

/**
 * Composite MinIO + Postgres {@link FreshnessCache}. The port is metadata-driven
 * (`listDue` needs an index on `next_due_at`; `record` needs atomic monotonic
 * tightening), so the lean metadata stays queryable in Postgres (the
 * `freshness_meta` table) and only the bulky `content` (`ScrapeUrlResult`,
 * incl. HTML) is offloaded to object storage.
 *
 * `record` is the `LEAST() + CASE` monotonic-tightening upsert on the tier
 * columns (verbatim from `PgFreshnessCache`, on `freshness_meta` instead of
 * `freshness`), PLUS a `putObject` of the content at a stable per-url key
 * (`freshness/<sha256(url)>.json`). The body is written first; the metadata
 * pointer is upserted after. The object key is stable per url, so a non-adopted
 * (looser) `record` still refreshes the body + `crawled_at`/`next_due_at`
 * exactly as the in-memory/Pg default does.
 *
 * `tryGet` rehydrates: metadata row + body blob. A missing or malformed body is
 * treated as a miss (never serve a half-reconstructed record). `listDue` is
 * PG-only; `delete` removes the row and best-effort-deletes the blob.
 *
 * Needs a `Queryable` (a `PgPoolQueryable` from `@use-pith/adapters-pg`) for the
 * metadata side, and a `BlobStore` for the body side. Peer-depends on
 * `@use-pith/adapters-pg` for the `Queryable` type.
 */
export class MinioFreshnessCache implements FreshnessCache {
  constructor(
    private readonly pg: Queryable,
    private readonly blob: BlobStore,
  ) {}

  async tryGet(url: string): Promise<FreshnessRecord | null> {
    const { rows } = await this.pg.query<FreshnessMetaRow>(
      `SELECT url, watched_tier, watched_tier_max_staleness_seconds,
              watched_tier_proactive_recrawl, crawled_at, next_due_at,
              content_object_key
       FROM freshness_meta WHERE url = $1`,
      [url],
    );
    const r = rows[0];
    if (!r) return null;
    const raw = await this.blob.get(r.content_object_key);
    if (raw === undefined) return null;
    let content: ScrapeUrlResult;
    try {
      content = JSON.parse(raw) as ScrapeUrlResult;
    } catch {
      return null;
    }
    if (!content || typeof content.markdown !== "string") return null;
    return {
      url: r.url,
      watchedTier: r.watched_tier,
      watchedTierMaxStalenessSeconds: Number(r.watched_tier_max_staleness_seconds),
      watchedTierProactiveRecrawl: r.watched_tier_proactive_recrawl,
      crawledAt: toDate(r.crawled_at),
      nextDueAt: toDate(r.next_due_at),
      content,
    };
  }

  async record(input: RecordFreshnessInput): Promise<void> {
    const objectKey = freshnessObjectKey(input.url);
    const nextDueAt = new Date(
      input.crawledAt.getTime() + input.requestedTierMaxStalenessSeconds * 1000,
    );
    // Body first, then the metadata pointer. Object key is stable per url, so
    // this overwrites (refreshes content) even when the tier isn't adopted.
    await this.blob.put(objectKey, JSON.stringify(input.content));
    await this.pg.query(
      `INSERT INTO freshness_meta
         (url, watched_tier, watched_tier_max_staleness_seconds,
          watched_tier_proactive_recrawl, crawled_at, next_due_at, content_object_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (url) DO UPDATE SET
         watched_tier = CASE
           WHEN EXCLUDED.watched_tier_max_staleness_seconds
                < freshness_meta.watched_tier_max_staleness_seconds
           THEN EXCLUDED.watched_tier ELSE freshness_meta.watched_tier END,
         watched_tier_max_staleness_seconds =
           LEAST(freshness_meta.watched_tier_max_staleness_seconds,
                 EXCLUDED.watched_tier_max_staleness_seconds),
         watched_tier_proactive_recrawl = CASE
           WHEN EXCLUDED.watched_tier_max_staleness_seconds
                < freshness_meta.watched_tier_max_staleness_seconds
           THEN EXCLUDED.watched_tier_proactive_recrawl
           ELSE freshness_meta.watched_tier_proactive_recrawl END,
         crawled_at = EXCLUDED.crawled_at,
         next_due_at = EXCLUDED.crawled_at
           + make_interval(secs => LEAST(
               freshness_meta.watched_tier_max_staleness_seconds,
               EXCLUDED.watched_tier_max_staleness_seconds)::float8),
         content_object_key = EXCLUDED.content_object_key`,
      [
        input.url,
        input.requestedTier,
        input.requestedTierMaxStalenessSeconds,
        input.requestedTierProactiveRecrawl,
        input.crawledAt,
        nextDueAt,
        objectKey,
      ],
    );
  }

  async listDue(now: Date): Promise<DueUrl[]> {
    const { rows } = await this.pg.query<{ url: string; watched_tier: string }>(
      `SELECT url, watched_tier FROM freshness_meta
       WHERE watched_tier_proactive_recrawl AND next_due_at <= $1`,
      [now],
    );
    return rows.map((r) => ({ url: r.url, watchedTier: r.watched_tier }));
  }

  async delete(url: string): Promise<boolean> {
    const { rows } = await this.pg.query<{ content_object_key: string }>(
      `DELETE FROM freshness_meta WHERE url = $1 RETURNING content_object_key`,
      [url],
    );
    if (rows.length === 0) return false;
    try {
      await this.blob.delete(rows[0]!.content_object_key);
    } catch {
      /* best-effort blob cleanup; the metadata row is already gone */
    }
    return true;
  }
}

/** Thin factory mirroring core's backend factories. */
export function createMinioFreshnessCache(
  pg: Queryable,
  blob: BlobStore,
): MinioFreshnessCache {
  return new MinioFreshnessCache(pg, blob);
}
