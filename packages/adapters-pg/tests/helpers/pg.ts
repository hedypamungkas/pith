import { Pool } from "pg";
import { PgPoolQueryable, runMigrations } from "../../src/index.js";

export interface PgHandle {
  client: PgPoolQueryable;
  pool: Pool;
  close: () => Promise<void>;
}

/**
 * Connect a real `pg.Pool` to `PG_DATABASE_URL`, apply migrations, and wrap it
 * as a {@link PgPoolQueryable}. For the gated `integration-real` suite only —
 * the `unit` suite uses PGlite (no container).
 */
export async function pgFromEnv(): Promise<PgHandle> {
  const url = process.env.PG_DATABASE_URL;
  if (!url) throw new Error("PG_DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url });
  const client = new PgPoolQueryable(pool);
  await runMigrations(client);
  return { client, pool, close: () => pool.end() };
}
