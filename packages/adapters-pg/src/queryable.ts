import type { Pool, PoolClient, QueryResultRow } from "pg";

/**
 * The minimal Postgres client surface the adapters depend on — a `query`
 * plus a serialized `tx`. The adapter code never imports `pg` types beyond
 * this seam, so the SAME adapter logic runs against two backends:
 *
 *   - prod: {@link PgPoolQueryable} over a real `pg.Pool`
 *   - tests: a PGlite-backed `Queryable` (in-process Postgres via WASM, no
 *     container) — this is what keeps the key-free `unit` project green while
 *     still exercising real SQL.
 *
 * `query` mirrors `pg`'s shape (`{ rows }`); `tx` runs `fn` inside
 * `BEGIN…COMMIT` (ROLLBACK on throw). Nested `tx` calls reuse the open
 * transaction (the minimal seam has no savepoints) — but only when nested on
 * the `Queryable` (`q`) handed to `fn`. Nesting on the outer `Pool`-backed
 * client instead checks out a second connection and starts a separate
 * transaction (a deadlock footgun under row locks).
 */
export interface Queryable {
  query<R = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[] }>;
  tx<R>(fn: (q: Queryable) => Promise<R>): Promise<R>;
}

/** A `Queryable` bound to one checked-out client — used inside an open tx. */
class PgClientQueryable implements Queryable {
  constructor(private readonly client: PoolClient) {}
  query<R = QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: R[] }> {
    return this.client.query(text, params) as unknown as Promise<{ rows: R[] }>;
  }
  tx<R>(fn: (q: Queryable) => Promise<R>): Promise<R> {
    return fn(this);
  }
}

/**
 * Wraps a `pg.Pool` as a {@link Queryable}. Standalone `query` calls use the
 * pool directly (auto client checkout); `tx` checks out a client, opens a
 * transaction, and releases it (with ROLLBACK on failure). Pass the `Pool` the
 * host already owns — the adapter never constructs one itself (no singleton,
 * no env reads — same ethos as the core search/extract backend factories).
 */
export class PgPoolQueryable implements Queryable {
  constructor(private readonly pool: Pool) {}
  query<R = QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: R[] }> {
    return this.pool.query(text, params) as unknown as Promise<{ rows: R[] }>;
  }
  async tx<R>(fn: (q: Queryable) => Promise<R>): Promise<R> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(new PgClientQueryable(client));
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        // Don't shadow the original error; attach the rollback failure as its
        // cause so a connection that died mid-transaction is still observable.
        if (err instanceof Error) err.cause = rollbackErr;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
