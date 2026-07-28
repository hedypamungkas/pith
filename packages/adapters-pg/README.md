# @use-pith/adapters-pg

> Postgres adapters for the [Pith](https://github.com/hedypamungkas/pith) CorePorts — drop-in persistence for `@use-pith/core`.

Pith runs **zero-infra by default** (in-memory / no-op ports). This package implements the four storage/cost ports the engine already consumes against a real Postgres connection, so crawl state, the cost ledger, the freshness cache, and request snapshots **persist across restarts and across processes**.

| Port | Adapter | Table(s) |
|---|---|---|
| `CrawlStateStore` | `PgCrawlStateStore` | `crawl_jobs`, `crawl_pages` |
| `CostRecorder` | `PgCostRecorder` | `cost_events` |
| `SnapshotStore` | `PgSnapshotStore` | `request_snapshots` |
| `FreshnessCache` | `PgFreshnessCache` | `freshness` |

`pg` is a dependency of **this package only** — `@use-pith/core` never imports it (enforced by core's `no-infra-on-import` smoke gate). `@use-pith/core` is a peer dependency.

## Install

```bash
npm install @use-pith/core @use-pith/adapters-pg pg
```

## Quickstart

```ts
import pg from "pg";
import { createEngine } from "@use-pith/core";
import {
  PgPoolQueryable,
  runMigrations,
  PgCrawlStateStore,
  PgCostRecorder,
  PgFreshnessCache,
  PgSnapshotStore,
} from "@use-pith/adapters-pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = new PgPoolQueryable(pool);

// Idempotent — safe to call on every boot.
await runMigrations(client);

const pith = createEngine({
  crawlStateStore: new PgCrawlStateStore(client),
  costRecorder: new PgCostRecorder(client),
  freshnessCache: new PgFreshnessCache(client),
  snapshotStore: new PgSnapshotStore(client),
});

// Crawl state, cost, freshness, and snapshots now survive restarts.
```

Swap in one port at a time — every port defaults to the in-memory/null impl, so you can persist crawl state while leaving the cost recorder no-op, etc.

## Migrations

`runMigrations(client)` applies every `migrations/*.sql` in order. The DDL is idempotent (`CREATE TABLE IF NOT EXISTS`), so re-running is a no-op. The schema is reconstructed from Pith's in-memory reference (`@use-pith/core`'s `InMemoryCrawlStateStore` / `InMemoryFreshnessCache`) — there is no platform schema in the OSS repo.

Load-bearing invariants preserved: `insertDiscoveredPages` enforces `maxPages` + `(crawl_id, url)` dedup under a serialized critical section (`SELECT … FOR UPDATE`); the freshness `record` upsert monotonically **tightens** the watched tier (`LEAST() + CASE`) so a looser concurrent write can't downgrade it; paused pages stay outstanding (no finalize).

## Notes

- **Bodies are inline for now.** `PgSnapshotStore` and `PgFreshnessCache` store the full payload (including bulky HTML) as JSONB — faithful to the in-memory defaults. A future `@use-pith/adapters-minio` offloads bodies to an object store and keeps a metadata row + `object_key` here.
- **`JobQueue` (BullMQ) is out of scope.** The engine doesn't consume `ports.queue` today, so a `@use-pith/adapters-bullmq` is blocked on an engine refactor first.

## License

Apache-2.0 — see [LICENSE](../../LICENSE).
