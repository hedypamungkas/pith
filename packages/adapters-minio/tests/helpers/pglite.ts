import { PGlite } from "@electric-sql/pglite";
import type { Queryable } from "../../src/queryable.js";

/**
 * A {@link Queryable} backed by PGlite — in-process Postgres via WASM. Used by
 * the MinioFreshnessCache unit tests for the metadata side (the body side uses
 * FakeMinioStore), so the suite runs with zero containers. Mirrors
 * `@use-pith/adapters-pg`'s helper, but applies THIS package's `freshness_meta`
 * migration.
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

/** Start an in-process PGlite and apply the freshness_meta migration. */
export async function makePglite(): Promise<PgliteHandle> {
  const db = new PGlite();
  const client: Queryable = new PgliteQueryable(db);
  const { runMigrations } = await import("../../src/migrate.js");
  await runMigrations(client);
  return { client, close: () => db.close() };
}
