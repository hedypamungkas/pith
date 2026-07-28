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
 * `pg` and PGlite.
 *
 * Limitation: the comment strip is textual, so a `--` inside a string literal
 * is stripped too, and a `;` inside a string/function body splits prematurely.
 * Migration files must follow "one `;`-terminated statement per DDL operation,
 * no `;`/`--` inside string literals or bodies".
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
 * Apply every `migrations/*.sql` (sorted by filename) in order, for this
 * package's own `freshness_meta` table. Idempotent (`CREATE TABLE IF NOT
 * EXISTS`). Reads the published `migrations/` dir relative to this module.
 * Independent of `@use-pith/adapters-pg`'s migrations — run both if you use
 * both adapters.
 */
export async function runMigrations(client: Queryable): Promise<void> {
  let files: string[];
  try {
    files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  } catch (err) {
    throw new Error(
      `@use-pith/adapters-minio: could not read migrations dir ${MIGRATIONS_DIR}: ${
        (err as Error).message
      }`,
    );
  }
  for (const file of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    const statements = splitStatements(sql);
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      if (!stmt) continue;
      try {
        await client.query(stmt);
      } catch (err) {
        throw new Error(
          `@use-pith/adapters-minio: migration ${file} statement #${i + 1} failed: ${
            (err as Error).message
          }\n-- statement:\n${stmt}`,
        );
      }
    }
  }
}
