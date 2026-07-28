import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makePglite, type PgliteHandle } from "../helpers/pglite.js";
import { runMigrations } from "../../src/migrate.js";

let h: PgliteHandle;
beforeEach(async () => {
  h = await makePglite(); // already applies migrations once
});
afterEach(async () => {
  await h.close();
});

describe("runMigrations", () => {
  it("is idempotent — re-running is a no-op and all tables exist", async () => {
    await runMigrations(h.client); // second application
    await runMigrations(h.client); // third
    const { rows } = await h.client.query<{ table: string }>(
      `SELECT tablename AS table FROM pg_tables WHERE schemaname = 'public'`,
    );
    const tables = rows.map((r) => r.table).sort();
    expect(tables).toEqual(
      expect.arrayContaining([
        "crawl_jobs",
        "crawl_pages",
        "cost_events",
        "request_snapshots",
        "freshness",
      ]),
    );
  });
});
