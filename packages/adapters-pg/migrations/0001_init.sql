-- Pith adapters-pg — initial schema.
--
-- Reconstructed from the in-memory reference in
-- packages/core/src/ports/nullPorts.ts (the behavioral spec) plus the
-- source-pointing comments there (FOR UPDATE + ON CONFLICT DO NOTHING;
-- LEAST() + CASE monotonic tier-tighten). Idempotent so runMigrations()
-- can re-run safely. Enum-like status columns are guarded by CHECK
-- constraints rather than PG enums to keep the DDL migration-light.
--
-- crawl_jobs / crawl_pages mirror the platform's crawl state machine:
--   crawl_jobs.status  : queued -> running -> {complete | partial | failed}
--   crawl_pages.status : pending -> {success | failed | paused}, paused -> pending

CREATE TABLE IF NOT EXISTS crawl_jobs (
  id                text PRIMARY KEY,
  root_url          text NOT NULL,
  status            text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'complete', 'partial', 'failed')),
  max_depth         integer NOT NULL,
  max_pages         integer NOT NULL,
  same_domain_only  boolean NOT NULL,
  include_patterns  text[],
  exclude_patterns  text[],
  ignore_robots_txt boolean NOT NULL,
  api_key_id        integer NOT NULL,
  auth_session_id   text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crawl_pages (
  id            bigserial PRIMARY KEY,
  crawl_id      text NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  url           text NOT NULL,
  depth         integer NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'success', 'failed', 'paused')),
  attempt_count integer NOT NULL DEFAULT 0,
  last_error    text,
  request_id    text,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  UNIQUE (crawl_id, url)
);
CREATE INDEX IF NOT EXISTS crawl_pages_crawl_idx ON crawl_pages(crawl_id);

-- Per-attempt cost ledger. `request_id` is nullable: the OSS engine calls
-- recordAttempts() below the handler layer where no requestId is in scope, so
-- raw per-attempt rows are logged unlinkable (request_id NULL) as a persistent
-- aggregate metering; requestId-linked rows (the entries the cost overlay's
-- getCostCentsForRequest sums) are written via recordCostEvent(). Failed
-- attempts are recorded (success=false) at 0 cents — the "failed attempts are
-- never billed" rule lives in the recorder, not the schema.
CREATE TABLE IF NOT EXISTS cost_events (
  id         bigserial PRIMARY KEY,
  request_id text,
  tier       text NOT NULL,
  success    boolean NOT NULL,
  cents      integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cost_events_request_idx ON cost_events(request_id);

-- Request inspection / replay snapshots. The full captured object (incl. the
-- bulky body) is stored inline as JSONB — faithful to InMemorySnapshotStore.
-- A later adapters-minio offloads the body to an object store and keeps only
-- a metadata row + object_key here.
CREATE TABLE IF NOT EXISTS request_snapshots (
  request_id text PRIMARY KEY,
  snapshot   jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Stale-while-revalidate scrape cache (freshness). `content` holds the full
-- ScrapeUrlResult as JSONB (same inline-for-now note as request_snapshots).
-- `next_due_at` is crawled_at + watched_tier_max_staleness_seconds — the
-- proactive-recrawl due time and the freshness deadline.
CREATE TABLE IF NOT EXISTS freshness (
  url                                text PRIMARY KEY,
  watched_tier                       text NOT NULL,
  watched_tier_max_staleness_seconds integer NOT NULL,
  watched_tier_proactive_recrawl     boolean NOT NULL,
  crawled_at                         timestamptz NOT NULL,
  next_due_at                        timestamptz NOT NULL,
  content                            jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS freshness_due_idx
  ON freshness(next_due_at)
  WHERE watched_tier_proactive_recrawl;
