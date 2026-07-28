# @use-pith/adapters-minio

> S3/MinIO adapters for the [Pith](https://github.com/hedypamungkas/pith) CorePorts — body offload for `@use-pith/core`.

`@use-pith/adapters-pg` persists crawl **state** + the cost ledger, but stores the bulky **bodies inline as JSONB**. This package moves those payloads to object storage, and gives `ContentStore` (page-content blobs) its first real backend.

| Port | Adapter | Body home | Metadata home |
|---|---|---|---|
| `ContentStore` | `MinioContentStore` | MinIO | — (pure) |
| `SnapshotStore` | `MinioSnapshotStore` | MinIO | — (pure — whole snapshot as one object) |
| `FreshnessCache` | `MinioFreshnessCache` | MinIO | Postgres (`freshness_meta`) |

`minio` is a dependency of **this package only** — `@use-pith/core` never imports it (enforced by core's `no-infra-on-import` smoke gate). `@use-pith/core` is a peer; `@use-pith/adapters-pg` is an **optional** peer (only `MinioFreshnessCache` needs a Postgres `Queryable`).

## Install

```bash
npm install @use-pith/core @use-pith/adapters-minio minio
# only if you use MinioFreshnessCache:
npm install @use-pith/adapters-pg pg
```

## Quickstart

```ts
import { createEngine } from "@use-pith/core";
import {
  createMinioBlobStore,
  MinioContentStore,
  MinioSnapshotStore,
} from "@use-pith/adapters-minio";

const blob = createMinioBlobStore({
  endPoint: process.env.MINIO_ENDPOINT!,     // host
  port: Number(process.env.MINIO_PORT!),     // 9000
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY!,
  secretKey: process.env.MINIO_SECRET_KEY!,
  bucket: process.env.MINIO_BUCKET!,
});
await blob.ensureBucket();                   // idempotent — create bucket if missing

const pith = createEngine({
  contentStore: new MinioContentStore(blob),
  snapshotStore: new MinioSnapshotStore(blob),
});
// crawl page markdown + request snapshots now land in object storage.
```

### Composite freshness (metadata in Postgres + content in MinIO)

```ts
import { PgPoolQueryable } from "@use-pith/adapters-pg";
import { runMigrations, MinioFreshnessCache } from "@use-pith/adapters-minio";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const pgClient = new PgPoolQueryable(pool);
await runMigrations(pgClient);   // creates this package's freshness_meta table

const pith = createEngine({
  contentStore: new MinioContentStore(blob),
  freshnessCache: new MinioFreshnessCache(pgClient, blob),
});
```

## Why each adapter has its storage shape

Driven by the **port contract**, not guessed:

- **`MinioContentStore`** — content is opaque blobs keyed by caller-supplied keys (`crawl-pages/<crawlId>/<pageId>.md`); no query needed.
- **`MinioSnapshotStore`** — the port is `capture`/`load` only (no list/query), so the whole snapshot is one object at `request-snapshots/<requestId>.json` and round-trips exactly for any shape.
- **`MinioFreshnessCache`** — `listDue` needs an index on `next_due_at` and `record` needs atomic monotonic tightening, so lean metadata stays queryable in Postgres and only the bulky `content` moves to MinIO. It owns its own `freshness_meta` table (not an `ALTER` on `adapters-pg`'s `freshness` table) — run this package's migrations independently.

A missing/malformed body blob is treated as a cache miss — never a half-reconstructed object.

## Notes

- Bodies are stored and returned as utf-8 **text** (page markdown, JSON snapshots). Not for arbitrary binary blobs.
- `adapters-bullmq` (`JobQueue`) is still deferred — the engine doesn't consume `ports.queue` yet.

## License

Apache-2.0 — see [LICENSE](../../LICENSE).
