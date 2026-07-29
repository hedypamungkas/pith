# ADR 0007: BullMQ adapter package (@use-pith/adapters-bullmq)

**Status:** Accepted

## Context

`@use-pith/core` ships a `JobQueue` port, but until recently only the in-process
default (`InProcessJobQueue`) existed — every `addX` ran inline in the engine's
event loop. ADRs 0005 and 0006 both deferred BullMQ as **blocked**:

> the engine does not consume `ports.queue` today (the crawler uses an in-process
> array), so BullMQ needs an engine refactor (enqueue → worker → wait) before it
> is useful.

That refactor landed in PR #17: the engine now routes `scrape` / `extract` /
`crawl` through `ports.queue.addX`, and the crawl drain loop drives
`queue.addCrawlPage` per batch. Each `addX` "drives ONE job to completion and
returns its result" — a contract a real runner can satisfy by enqueuing and
awaiting the worker's return value. So a distributed, Redis-backed `JobQueue` is
now buildable **with no core change** — the last CorePorts port without a real
adapter.

## Decision

Ship **`@use-pith/adapters-bullmq`** with two surfaces, both reusing the SAME
processor factories (`createScrapeProcessor` / `createCrawlPageProcessor` /
`createExtractProcessor`) the in-process engine uses:

- **`BullMqJobQueue implements JobQueue`** (producer): each `addX` enqueues a job
  on its dedicated queue and awaits the worker's return value via
  `Job.waitUntilFinished(queueEvents)` — BullMQ's request/reply pattern. Injected
  via `createEngine({ queue: new BullMqJobQueue(redis, { concurrency }) })`.
- **`runWorkers`** (worker-process host): three `Worker`s (one per queue) that
  drain jobs and run the host-supplied processors, returning each result so the
  producer yields it.

Key choices:

- **Three named queues** (`pith-scrape` / `pith-crawl` / `pith-extract`) shared as
  constants — the producer↔worker agreement. One Worker per queue (BullMQ binds a
  Worker to one queue), so the three job types scale independently. (BullMQ
  forbids `:` in queue names — it uses `:` as the Redis key separator — so the
  names use hyphens; namespacing lives in the name, BullMQ's key `prefix` stays
  at its default.)
- **The adapter stays pure — the host supplies the processors.** `runWorkers`
  runs only what it's given; it never imports `scrapeUrlCore` / pricing /
  extraction backends. So "no infrastructure on import" is preserved (the core
  smoke gate already forbids `bullmq`/`ioredis` in core; this package owns them).
- **Result via `waitUntilFinished`, with bounded `removeOnComplete` on the
  Queue.** `removeOnComplete` MUST be on the Queue's `defaultJobOptions` as a
  bounded count — never on the Worker, never bare `true`: that races
  `waitUntilFinished` and throws "job not found" (BullMQ #2620). The count caps
  steady-state Redis growth from transient result storage.
- **Worker / QueueEvents connections need `maxRetriesPerRequest: null`** (BullMQ
  issues blocking commands); `normalizeBlockingConnection` sets it. The producer
  (Queue) does not.
- **`concurrency` stays on `JobQueue`.** BullMQ parallelism is a
  deployment/topology property (producer + workers share one configured width),
  not a per-crawl caller concern; `BullMqJobQueue` exposes it `readonly` from its
  constructor, set to match the worker concurrency so the crawl drain keeps the
  workers fed.
- **Crash/resume composes for free:** BullMQ delivers at-least-once, and the
  crawl-page processor's `getPageStatus` idempotency gate makes a redelivered,
  already-finalized page a no-op (returns `[]`) — no re-scrape, no re-bill.

## Consequences

- A self-hoster now runs scrape / crawl / extract across Redis with real
  parallelism: one process `createEngine({ queue: new BullMqJobQueue(...) })`,
  one or more worker processes `runWorkers(...)` on the same Redis + queue names.
- `@use-pith/core` is unchanged — the port, the payload types
  (`ScrapeJobData` / `ExtractJobData` / `CrawlPageJobData`), and the processor
  factories + signatures were all exported by PR #17.
- **Thinner key-free unit coverage than pg/minio.** BullMQ has no in-process
  double (ioredis-mock cannot emulate the Redis streams BullMQ depends on), and a
  dead-port `new Queue()` emits fatal unhandled `error` events. So the `unit`
  project covers pure helpers only (queue names, connection normalization, the
  bounded-`removeOnComplete` guard); the full enqueue→worker→`waitUntilFinished`
  behavior, worker concurrency, and the engine + queue crawl E2E live in the gated
  `integration-real` suite (real Redis via the shared compose, run nightly). The
  crawl drain loop itself is already covered key-free in core via
  `InProcessJobQueue`.
- `adapters-nightly.yml` now stands up Postgres + MinIO + Redis via the shared
  `scripts/docker-compose.adapters.yml` and runs all three adapter packages'
  `integration-real` suites.
- Publishing requires registering a Trusted Publisher for
  `@use-pith/adapters-bullmq` on npmjs.com (one-time, as done for core /
  adapters-pg / adapters-minio).

## Scope / deferred

- Repeating / scheduled jobs, flows/producers, and rate limiting — BullMQ
  features beyond the single-shot `addX → result` RPC the port models.
- A runnable worker CLI/bin. `runWorkers` is a host-called function (the host
  builds the processors from core factories with real deps and owns process
  lifecycle) — matching the "host owns the client" ethos of the pg/minio adapters.

## Revisit if

- `ioredis-mock` gains BullMQ-clean Redis streams support — then a key-free
  contract test mirroring `InProcessJobQueue`'s behavior becomes viable.
- A per-call drain-concurrency need appears (today `concurrency` is a deployment
  property on the queue; a caller-driven frontier width would move it to
  `CrawlKickoffOptions`).
- Result payloads exceed the bounded `removeOnComplete` budget — then revisit
  whether scrape/extract results should bypass `waitUntilFinished` storage.
