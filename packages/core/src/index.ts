/**
 * Pith — the essential web, for agents.
 *
 * Public entrypoint. Importing this module and calling `createEngine()` must
 * pull in ZERO host infrastructure — enforced by the `smoke` project
 * (`tests/smoke/no-infra-on-import.test.ts`) and the `import/no-restricted-paths`
 * lint rule. Engine method bodies (scrape/crawl/extract/search) land in spin-off
 * step 3; until then they throw `NotImplementedError`.
 */
export { createEngine } from "./engine.js";
export type { Engine } from "./engine.js";
export { NotImplementedError, NotConfiguredError } from "./errors.js";
export { createNullPorts } from "./ports/nullPorts.js";
export type {
  CorePorts,
  CallerContext,
  CostRecorder,
  SnapshotStore,
  CrawlStateStore,
  ContentStore,
  JobQueue,
  RobotsResolver,
  FreshnessCache,
  Clock,
} from "./ports/corePorts.js";
