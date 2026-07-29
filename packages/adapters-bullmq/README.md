# @use-pith/adapters-bullmq

Distributed job runner for [`@use-pith/core`](../../README.md) — a
BullMQ/Redis-backed `JobQueue` so scrape / crawl-page / extract work runs across
worker processes instead of inline in the engine.

| Surface          | Role                                                       | Core port  |
| ---------------- | ---------------------------------------------------------- | ---------- |
| `BullMqJobQueue` | Producer — enqueues a job and awaits the worker's result   | `JobQueue` |
| `runWorkers`     | Worker host — drains the three queues, runs the processors | —          |

Both reuse the **same processor factories** the in-process engine builds
(`createScrapeProcessor` / `createCrawlPageProcessor` / `createExtractProcessor`),
so a worker runs identical logic to `InProcessJobQueue`.

## Install

```sh
npm install @use-pith/core @use-pith/adapters-bullmq ioredis
```

`bullmq` + `ioredis` are dependencies of this package only — core never imports
them (enforced by the core smoke gate `no-infra-on-import`). `@use-pith/core` is a
peer.

## Quickstart

Two processes share one Redis and the queue names (`pith-scrape`,
`pith-crawl`, `pith-extract`): an **engine process** that produces jobs through
the queue, and one or more **worker processes** that consume them.

```ts
import Redis from "ioredis";
import {
  createEngine,
  createScrapeProcessor,
  createCrawlPageProcessor,
  createExtractProcessor,
} from "@use-pith/core";
import { BullMqJobQueue, runWorkers } from "@use-pith/adapters-bullmq";

const redis = new Redis(process.env.REDIS_URL!); // host-owned
const concurrency = 8;

// --- worker process: build the processors with REAL deps, then drain ---
const workers = runWorkers(redis, {
  scrape: createScrapeProcessor({/* centsForTier, robotsResolver, costRecorder */}),
  crawlPage: createCrawlPageProcessor({/* scrape, stateStore, contentStore, ... */}),
  extract: createExtractProcessor({/* scrape, extract, centsForTier */}),
  concurrency, // match the producer's concurrency so the crawl stays saturated
});

// --- engine process: produce jobs through the Redis queue ---
const pith = createEngine({ queue: new BullMqJobQueue(redis, { concurrency }) });
await pith.crawl("https://example.com/", { maxDepth: 3, maxPages: 100 });

// shutdown
await workers.close();
```

## Notes

- **Result passing.** Each `addX` enqueues a job and awaits the worker's return
  value via `Job.waitUntilFinished`. Auto-removal is bounded on the **Queue's**
  `defaultJobOptions` (`removeOnComplete: { count: 1000 }`) — never on the Worker
  and never bare `true`, which races `waitUntilFinished` (BullMQ #2620). Results
  sit in Redis transiently until reaped.
- **Concurrency.** `BullMqJobQueue`'s `concurrency` is the crawl drain's batch
  width; set it to match `runWorkers`' `concurrency` so the producer keeps the
  workers fed. (Scrape/extract are single awaits and ignore it.)
- **Crash/resume.** BullMQ delivers at-least-once; the crawl-page processor's
  `getPageStatus` gate makes a redelivered, already-finalized page a no-op — safe
  to re-drive a worker that crashed mid-job.
- **Worker connections.** BullMQ's blocking consumers (Worker, QueueEvents)
  require `maxRetriesPerRequest: null`; the adapter sets it when you pass
  connection options. Pass the host-owned connection (options or an `ioredis`
  instance) — the adapter never reads env.

## License

Apache-2.0 — see [`../../LICENSE`](../../LICENSE).
