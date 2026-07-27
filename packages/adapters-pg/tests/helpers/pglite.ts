import { PGlite } from "@electric-sql/pglite";
import type { Queryable } from "../../src/queryable.js";

/**
 * A {@link Queryable} backed by PGlite — in-process Postgres via WASM. This is
 * what lets the adapter's unit tests run REAL SQL with zero containers (the
 * `unit` vitest project stays key-free, mirroring core's matrix). `pg`'s
 * `Pool.query` and PGlite's `query` share the `{ rows }` shape; transactions
 * use PGlite's `transaction()` helper.
 *
 * PGlite is single-threaded (no real row locks), so the concurrency-sensitive
 * paths are additionally covered by the containerized `integration-real`
 * suite against real Postgres.
 */
class PgliteQueryable implements Queryable {
  constructor(private readonly db: PGlite) {}
  query<R = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[] }> {
    return this.db.query<R>(text, params) as Promise<{ rows: R[] }>;
  }
  async tx<R>(fn: (q: Queryable) => Promise<R>): Promise<R> {
    return this.db.transaction(async (tx) => {
      const scoped: Queryable = {
        query: <R2 = Record<string, unknown>>(
          text: string,
          params?: unknown[],
        ): Promise<{ rows: R2[] }> =>
          tx.query<R2>(text, params) as Promise<{ rows: R2[] }>,
        tx: <R3>(f3: (q: Queryable) => Promise<R3>) => f3(scoped),
      };
      return fn(scoped);
    });
  }
}

export interface PgliteHandle {
  client: Queryable;
  close: () => Promise<void>;
}

/** Start an in-process PGlite and apply the adapter migrations to it. */
export async function makePglite(): Promise<PgliteHandle> {
  const db = new PGlite();
  const client: Queryable = new PgliteQueryable(db);
  const { runMigrations } = await import("../../src/migrate.js");
  await runMigrations(client);
  return { client, close: () => db.close() };
}
