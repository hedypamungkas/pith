import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Queryable } from "./queryable.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, "..", "migrations");

/**
 * Split a `.sql` file into individual statements. Strips `--` line comments
 * and splits on `;`, which is safe for table/index DDL (no embedded
 * semicolons). Running one statement per `query` keeps behavior identical on
 * `pg` and PGlite (neither reliably returns a usable result for a
 * multi-statement string in the minimal `Queryable` shape).
 *
 * Migration files must follow the "one `;`-terminated statement per DDL
 * operation, no `;` inside strings/bodies" rule.
 */
function splitStatements(sql: string): string[] {
  const stripped = sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  return stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Apply every `migrations/*.sql` (sorted by filename) in order. Idempotent —
 * the DDL uses `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, so
 * re-running is a no-op and safe to call on every boot. Reads the published
 * `migrations/` dir relative to this module, so no fs path is hard-coded.
 */
export async function runMigrations(client: Queryable): Promise<void> {
  let files: string[];
  try {
    files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch (err) {
    throw new Error(
      `@use-pith/adapters-pg: could not read migrations dir ${MIGRATIONS_DIR}: ${
        (err as Error).message
      }`,
    );
  }
  for (const file of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    for (const stmt of splitStatements(sql)) {
      await client.query(stmt);
    }
  }
}
