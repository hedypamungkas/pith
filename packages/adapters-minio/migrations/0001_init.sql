-- Pith adapters-minio — freshness metadata table (owned by this package).
--
-- MinioFreshnessCache is a COMPOSITE adapter: the bulky `content`
-- (ScrapeUrlResult, incl. HTML) lives in object storage; this table holds only
-- the lean, queryable metadata + the object_key that points at the body blob.
-- It is self-contained — NOT an ALTER on @use-pith/adapters-pg's `freshness`
-- table — so the two adapters don't collide if both are installed, and a host
-- runs this migration independently of adapters-pg's.
--
-- The monotonic-tightening upsert (LEAST() + CASE) operates on the tier
-- columns exactly as PgFreshnessCache's does — only the content destination
-- differs (object_key here vs inline jsonb there).

CREATE TABLE IF NOT EXISTS freshness_meta (
  url                                text PRIMARY KEY,
  watched_tier                       text NOT NULL,
  watched_tier_max_staleness_seconds integer NOT NULL,
  watched_tier_proactive_recrawl     boolean NOT NULL,
  crawled_at                         timestamptz NOT NULL,
  next_due_at                        timestamptz NOT NULL,
  content_object_key                 text NOT NULL
);
CREATE INDEX IF NOT EXISTS freshness_meta_due_idx
  ON freshness_meta(next_due_at)
  WHERE watched_tier_proactive_recrawl;
