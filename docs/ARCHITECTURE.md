# Architecture

Pith is **one core, three faces**, built on a ports-and-adapters (hexagonal) spine so the engine runs with zero infrastructure by default and adopts real backends as optional adapters.

## One core, three faces

```text
   SDK  ──┐
   HTTP ──┼──▶  createEngine()  ·  scrape · crawl · extract · search
   MCP  ──┘     (one request-handling core, three transports)
                        │
                        ▼
                  CorePorts  (8 ports, null defaults + caller overrides)
                  real adapters optional — Postgres / MinIO / BullMQ / …

   SDK  → @use-pith/core      HTTP → @use-pith/core/http      MCP → @use-pith/core/mcp
```

- **SDK** (`createEngine`) — call `scrape` / `crawl` / `extract` / `search` in-process. The primary surface.
- **HTTP** (`@use-pith/core/http`) — `createServer({ engine })`, a Fastify app exposing `/health` + `/v1/*` (see [`openapi.yaml`](./openapi.yaml)). No built-in auth — gate it with your own Fastify middleware in front of the returned app.
- **MCP** (`@use-pith/core/mcp`) — `buildMcpServer({ engine })`, 5 tools (`scrape`, `search`, `crawl`, `get_crawl_status`, `extract`). Optional cost overlay via `costOverlay`.

The HTTP and MCP faces share the same pure request handlers as the SDK — one request-handling core, three transports. `fastify`, `@modelcontextprotocol/sdk`, and `playwright` are **optional peers**, dynamically imported only by the face that needs them, so an SDK-only consumer installs nothing extra.

## Ports & adapters

Every host concern is an injectable port with an in-memory / no-op default. `createEngine()` with no arguments composes exactly these defaults via `createNullPorts()`; callers shallow-merge overrides (`createEngine({ freshnessCache: myRedisCache, clock: fakeClock })`).

| Port              | Responsibility                                                                | Null default (`createNullPorts`)                                   | Real adapter (optional)                                   |
| ----------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| `costRecorder`    | per-attempt cost metering; `getCostCentsForRequest` for the MCP overlay       | `NoopCostRecorder` (records nothing)                               | Postgres `cost_events` ledger                             |
| `snapshotStore`   | request inspection / replay snapshots                                         | `InMemorySnapshotStore`                                            | object store                                              |
| `crawlStateStore` | crawl jobs/pages state machine; `maxPages` + dedup under a serialized section | `InMemoryCrawlStateStore` (full state machine + mutex)             | Postgres `crawl_jobs`/`crawl_pages`                       |
| `contentStore`    | page-content blobs                                                            | `InMemoryContentStore`                                             | MinIO/S3                                                  |
| `queue`           | scrape/crawl-page/extract jobs                                                | throwing placeholder (`createEngine` supplies `InProcessJobQueue`) | BullMQ                                                    |
| `robotsResolver`  | `robots.txt` compliance                                                       | `AllowAllRobotsResolver` (zero-network)                            | `createRobotsResolver()` (real, spec-compliant fail-open) |
| `freshnessCache`  | stale-while-revalidate scrape cache; monotonic tier tightening                | `InMemoryFreshnessCache` (full tightening mutex)                   | Postgres metadata + object-store body                     |
| `clock`           | `now`, for testable time math                                                 | `() => new Date()`                                                 | —                                                         |

The engine reads ports only through this interface — a real backend never touches engine logic. Backends that need a job runner, persistence, or a KMS land as separate adapter packages, not in core.

## The "no infrastructure on import" invariant

Importing `@use-pith/core` and calling `createEngine()` must pull in **zero host infrastructure**. This is enforced two ways:

1. **A smoke test** (`packages/core/tests/smoke/no-infra-on-import.test.ts`) that imports the package and asserts no infra module is reachable.
2. **An ESLint rule** (`import/no-restricted-paths`) forbidding `packages/core/src/**` from importing `pg`, `ioredis`, `bullmq`, `minio`, `kafkajs`, or any module that constructs an infra client at load time.

The headless tier (Playwright) and the HTTP/MCP faces are **lazily** imported (`await import(...)`) so a static-only or SDK-only consumer pays nothing for them.

## Carve-out boundary

Pith was carved out of a production platform along a strict boundary:

- **IN (pure leaves):** `scrapeUrlCore`, `pureCrawler`, `extractPure`, `computeFreshness`, `composeFreshness`, the citation verifier, the field matcher, the SSRF guard, the Readability→markdown pipeline, the budget math, pricing. No host dependency.
- **EXCLUDE (platform):** the hosted API server, billing/console/auth-session routes, the DB schema + migrations, the KMS-backed session vault, the pilot-partner tooling, the docker-compose. These stay in the platform repo.
- **OPTIONALIZE (ports):** every host concern above. The contract ships in core; real implementations ship as adapters.

Load-bearing invariants preserved from the source: the `spentCents` budget mutation sites in scrape escalation; crawl's "insert discovered children before marking the parent success"; the `getPageStatus` idempotency gate; the freshness cache's monotonically-tightening watched tier; the failed-attempt-costs-zero (pay-per-success) rule.

## Further reading

- [`openapi.yaml`](./openapi.yaml) — the HTTP face contract.
- [`adr/0001-search-backend.md`](./adr/0001-search-backend.md), [`adr/0004-robots-txt-compliance.md`](./adr/0004-robots-txt-compliance.md) — key decisions.
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — dev setup + the test matrix.
