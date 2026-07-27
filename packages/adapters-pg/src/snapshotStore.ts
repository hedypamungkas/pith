import type { SnapshotStore } from "@use-pith/core";
import type { Queryable } from "./queryable.js";

interface SnapshotLike {
  requestId?: string;
}

/**
 * Postgres-backed {@link SnapshotStore} over the `request_snapshots` table.
 *
 * Faithful to {@link InMemorySnapshotStore} for string `requestId`s: `capture`
 * only persists when the object carries a string `requestId` (the column is
 * `text`; the in-memory default is looser — it accepts any `requestId` via an
 * `in` check, which this adapter rejects). The full snapshot —
 * including the bulky body — is stored inline as JSONB (matching the in-memory
 * default, which keeps everything in memory). A later `adapters-minio`
 * offloads the body to an object store and keeps only a metadata row +
 * `object_key` here; that is a future shape, not a behavior change.
 *
 * Both `pg` and PGlite parse the jsonb column back into a JS object on read,
 * so `load` returns the structured snapshot verbatim.
 */
export class PgSnapshotStore implements SnapshotStore {
  constructor(private readonly client: Queryable) {}

  async capture(snapshot: unknown): Promise<void> {
    const s = snapshot as SnapshotLike | null;
    if (!s || typeof s !== "object" || typeof s.requestId !== "string") return;
    await this.client.query(
      `INSERT INTO request_snapshots (request_id, snapshot)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (request_id) DO UPDATE SET snapshot = EXCLUDED.snapshot`,
      [s.requestId, JSON.stringify(snapshot)],
    );
  }

  async load(requestId: string): Promise<unknown> {
    const { rows } = await this.client.query<{ snapshot: unknown }>(
      `SELECT snapshot FROM request_snapshots WHERE request_id = $1`,
      [requestId],
    );
    return rows[0]?.snapshot ?? undefined;
  }
}

/** Thin factory mirroring core's backend factories. */
export function createPgSnapshotStore(client: Queryable): PgSnapshotStore {
  return new PgSnapshotStore(client);
}
