# ADR 0006: MinIO adapter package (@use-pith/adapters-minio)

**Status:** Accepted

## Context

`@use-pith/adapters-pg` (ADR 0005) persists crawl **state** + the cost ledger
+ freshness/snapshot **metadata** in Postgres, but stores the bulky
**bodies inline as JSONB** — the exact anti-pattern the carve-out notes flagged
("a later `adapters-minio` offloads the body to an object store"). Two gaps
remain for a self-hoster:

1. **`ContentStore`** (page-content blobs) has no real backend — crawl page
   markdown lives only in the in-memory default.
2. The PG snapshot/freshness adapters put large HTML payloads in Postgres, which
   bloats the DB and duplicates content.

## Decision

Ship **`@use-pith/adapters-minio`**, with three adapters whose storage shape
is driven by the **port contract** (not guessed):

| Adapter | Port | Body home | Metadata home | Rationale |
|---|---|---|---|---|
| `MinioContentStore` | `ContentStore` (put/get/list/delete) | MinIO | — | Opaque blobs keyed by caller keys; no query needed. |
| `MinioSnapshotStore` | `SnapshotStore` (capture/load only) | MinIO | — | Port has **no list/query** → whole snapshot is one object at `request-snapshots/<id>.json`; round-trips for any shape. |
| `MinioFreshnessCache` | `FreshnessCache` (tryGet/record/**listDue**/delete + tighten) | MinIO | **Postgres** | `listDue` needs a `next_due_at` index; `record` needs atomic monotonic tightening — both need queryable metadata, so only the bulky `content` moves to MinIO. |

Key choices:

- **`BlobStore` seam** (`{ put, get, list, delete }`, structurally identical to
  `ContentStore`) — the MinIO analog of adapters-pg's `Queryable`. `MinioContentStore`
  *is* a BlobStore over a bucket; the offload adapters reuse it for bodies.
- **Container-free unit tests via `FakeMinioStore`** (in-memory `Map`), the MinIO
  analog of PGlite — MinIO has no in-process equivalent. Real MinIO only in the
  gated `integration-real` suite.
- **`MinioFreshnessCache` owns its own `freshness_meta` table** (NOT an `ALTER`
  on adapters-pg's `freshness` table): self-contained, no cross-migration
  coupling, no collision if both adapters are installed. The tightening SQL
  (`LEAST() + CASE`) is duplicated verbatim from `PgFreshnessCache` on the new
  table — acceptable, since a host uses one freshness backend per deployment.
  Content object key = `freshness/<sha256(url)>.json` (URLs aren't key-safe).
- **`adapters-pg` is an OPTIONAL peer** — only `MinioFreshnessCache` needs a
  Postgres `Queryable` (for `freshness_meta`); `MinioContentStore` /
  `MinioSnapshotStore` are pure-MinIO. Marked optional in `peerDependenciesMeta`.
- **Robust round-trips** — a missing/malformed body blob is a cache miss
  (`null`/`undefined`), never a half-reconstructed object.

## Consequences

- A self-hoster now offloads content: `contentStore: new MinioContentStore(blob)`,
  and switching `snapshotStore`/`freshnessCache` to the MinIO variants moves the
  bulky bodies out of Postgres (lean DB, content in object storage).
- `@use-pith/core` is unchanged — all ports + key schemes
  (`objectKeyForRequestSnapshot`) were already exported.
- Publishing requires registering a Trusted Publisher for `@use-pith/adapters-minio`
  on npmjs.com (one-time, as done for core / adapters-pg).
- `adapters-nightly.yml` now stands up Postgres + MinIO via the shared
  `scripts/docker-compose.adapters.yml` (`up -d --wait`) and runs both adapter
  packages' `integration-real` suites.

## Scope / deferred

- **`adapters-bullmq` (`JobQueue`) is still blocked** — the engine does not
  consume `ports.queue` today; needs an enqueue→worker→wait refactor first.
- The platform's SQL-queryable snapshot **metadata** (DSAR scans, replay
  listings) isn't exposed by the OSS `SnapshotStore` port (capture/load only),
  so `MinioSnapshotStore` is pure-MinIO. If a future port adds snapshot listing,
  a PG-metadata + object-body composite would layer on (like the freshness one).

## Revisit if

- A binary (non-text) `ContentStore` use case appears — bodies are currently
  stored/returned as utf-8 text.
- A port adds snapshot listing/query — then split snapshot metadata into PG
  (parity with `MinioFreshnessCache`'s composite shape).
