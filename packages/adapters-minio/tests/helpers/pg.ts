import { Pool } from "pg";
import { PgPoolQueryable } from "@use-pith/adapters-pg";
import { runMigrations } from "../../src/index.js";

export interface PgHandle {
  client: PgPoolQueryable;
  pool: Pool;
  close: () => Promise<void>;
}

/**
 * Connect a real `pg.Pool`, apply the `freshness_meta` migration, and wrap as a
 * `PgPoolQueryable`. For the gated `integration-real` freshness test only.
 */
export async function pgFromEnv(): Promise<PgHandle> {
  const url = process.env.PG_DATABASE_URL;
  if (!url) throw new Error("PG_DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url });
  const client = new PgPoolQueryable(pool);
  await runMigrations(client);
  return { client, pool, close: () => pool.end() };
}
