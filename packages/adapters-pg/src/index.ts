/**
 * @use-pith/adapters-pg — Postgres adapters for the Pith CorePorts.
 *
 * Drop-in persistence for `@use-pith/core`: implements the four storage/cost
 * ports the engine already consumes (`CrawlStateStore`, `CostRecorder`,
 * `SnapshotStore`, `FreshnessCache`) over a real Postgres connection. Because
 * the ports already exist in core, you compose these exactly like the
 * in-memory defaults:
 *
 *   import pg from "pg";
 *   import { createEngine } from "@use-pith/core";
 *   import {
 *     PgPoolQueryable, runMigrations,
 *     PgCrawlStateStore, PgCostRecorder, PgFreshnessCache, PgSnapshotStore,
 *   } from "@use-pith/adapters-pg";
 *
 *   const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
 *   const client = new PgPoolQueryable(pool);
 *   await runMigrations(client);
 *   const pith = createEngine({
 *     crawlStateStore: new PgCrawlStateStore(client),
 *     costRecorder: new PgCostRecorder(client),
 *     freshnessCache: new PgFreshnessCache(client),
 *     snapshotStore: new PgSnapshotStore(client),
 *   });
 *
 * `pg` is a dependency of THIS package only — core never imports it (enforced
 * by the core smoke gate `no-infra-on-import`). `@use-pith/core` is a peer.
 */

export { PgPoolQueryable } from "./queryable.js";
export type { Queryable } from "./queryable.js";
export { runMigrations } from "./migrate.js";

export {
  PgCrawlStateStore,
  createPgCrawlStateStore,
} from "./crawlStateStore.js";
export { PgCostRecorder, createPgCostRecorder } from "./costRecorder.js";
export { PgSnapshotStore, createPgSnapshotStore } from "./snapshotStore.js";
export { PgFreshnessCache, createPgFreshnessCache } from "./freshnessCache.js";
