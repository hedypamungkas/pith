# ADR 0005: Postgres adapter package (@use-pith/adapters-pg)

**Status:** Accepted

## Context

Pith's ports-and-adapters spine ships every host concern behind a port with an
in-memory / no-op default, so `createEngine()` runs with zero infrastructure.
That makes the engine trivially embeddable, but its state is **volatile**:
crawl jobs, the cost ledger, the freshness cache, and request snapshots vanish
on restart and don't survive across processes. To self-host Pith against a
real backend, those four ports need real implementations.

Four of the eight `CorePorts` are storage/cost concerns the engine already
consumes today (`CrawlStateStore`, `CostRecorder`, `SnapshotStore`,
`FreshnessCache`); the other storage concerns are `ContentStore` (object
store) and `JobQueue` (job runner). The platform backing was Postgres for the
first four, object store for content, BullMQ for the queue — but the platform
schema and adapters were explicitly excluded from the OSS carve-out
(`docs/ARCHITECTURE.md`, "EXCLUDE (platform)").

## Decision

Ship a sibling workspace package **`@use-pith/adapters-pg`** that implements
the four Postgres-backed ports. It is a true drop-in: the port interfaces
already exist and are exported from `@use-pith/core`, so a host composes it
exactly like the in-memory defaults — `createEngine({ crawlStateStore:
new PgCrawlStateStore(client), ... })`.

- **Package boundary:** `pg` is a direct `dependency` of this package only.
  The core's `no-infra-on-import` smoke gate (and a tightened
  `import/no-restricted-paths` zone) guarantee core never imports it.
- **`Queryable` seam:** the adapters depend on a minimal
  `{ query, tx }` interface, not on `pg.Pool` directly. Prod wraps a `pg.Pool`;
  unit tests wrap `@electric-sql/pglite` (in-process Postgres via WASM) so the
  key-free `unit` vitest project exercises **real SQL** with zero containers.
- **SQL reconstruction:** the platform schema isn't in the OSS repo, so the
  DDL is reconstructed from the in-memory reference (`InMemoryCrawlStateStore`,
  `InMemoryFreshnessCache`) and the source-pointing comments. Load-bearing
  invariants are preserved verbatim: `insertDiscoveredPages` enforces
  `maxPages` + `(crawl_id,url)` dedup under `SELECT … FOR UPDATE`; the
  freshness `record` upsert monotonically tightens the watched tier
  (`LEAST() + CASE`); paused pages stay outstanding; failed attempts bill 0.
- **Two-tier tests:** PGlite unit tests (contract parity with core's in-memory
  tests, container-free) + gated `integration-real` tests against containerized
  Postgres (concurrency + an engine restart-survival E2E), in a new
  `adapters-nightly.yml`. `ci.yml` stays key-free.

## Scope

- **IN:** `PgCrawlStateStore`, `PgCostRecorder`, `PgSnapshotStore`,
  `PgFreshnessCache`, `runMigrations`, the `Queryable` seam.
- **OUT (deferred):**
  - **Bodies are inline for now.** `PgSnapshotStore` / `PgFreshnessCache`
    store the full payload (incl. bulky HTML) as JSONB, faithful to the
    in-memory defaults. A future `@use-pith/adapters-minio` offloads bodies to
    an object store and keeps a metadata row + `object_key` here.
  - **`ContentStore` (MinIO/S3)** → `adapters-minio`.
  - **`JobQueue` (BullMQ)** → `adapters-bullmq`, **blocked**: the engine does
    not consume `ports.queue` today (the crawler uses an in-process array), so
    BullMQ needs an engine refactor (enqueue → worker → wait) before it is
    useful. That is separate, larger work.

## Consequences

- A host can now persist Pith state by `npm install @use-pith/adapters-pg` +
  one connection + `runMigrations`, swapping ports one at a time.
- `@use-pith/core` is unchanged except an additive export of `CreateCrawlInput`
  (already part of the public `CrawlStateStore.createCrawl` signature; needed
  by any adapter author).
- Publishing requires registering a Trusted Publisher for
  `@use-pith/adapters-pg` on npmjs.com (one-time, as done for core).

## Revisit if

- A real need for connection pooling/replica reads appears (the seam wraps a
  single `Pool`; read/write splitting would extend `Queryable`).
- The inline-JSONB body storage becomes a cost/size problem before
  `adapters-minio` lands (then prioritize the object-store split).
