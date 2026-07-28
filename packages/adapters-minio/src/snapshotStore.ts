import type { SnapshotStore } from "@use-pith/core";
import { objectKeyForRequestSnapshot } from "@use-pith/core";
import type { BlobStore } from "./blobStore.js";

interface SnapshotLike {
  requestId?: string;
}

/**
 * MinIO-backed {@link SnapshotStore} — a pure-object-store alternative to
 * {@link PgSnapshotStore} that offloads the whole snapshot (incl. the bulky
 * HTML body) out of Postgres. The port surface is `capture`/`load` only (no
 * list/query), so the snapshot is stored as one object at the canonical
 * `request-snapshots/<requestId>.json` key (core's
 * `objectKeyForRequestSnapshot`) and round-trips exactly for any shape.
 *
 * Parity with {@link InMemorySnapshotStore} / `PgSnapshotStore`: `capture` is a
 * no-op when the object lacks a string `requestId`; `load` returns `undefined`
 * for a missing key. The JSON round-trip matches `PgSnapshotStore` (which
 * stores `$2::jsonb`) — both serialize, so a payload is JSON-safe in practice
 * (the crawler's snapshot carries no `Date` values).
 */
export class MinioSnapshotStore implements SnapshotStore {
  constructor(private readonly blob: BlobStore) {}

  async capture(snapshot: unknown): Promise<void> {
    const s = snapshot as SnapshotLike | null;
    if (!s || typeof s !== "object" || typeof s.requestId !== "string") return;
    await this.blob.put(
      objectKeyForRequestSnapshot(s.requestId),
      JSON.stringify(snapshot),
    );
  }

  async load(requestId: string): Promise<unknown> {
    const raw = await this.blob.get(objectKeyForRequestSnapshot(requestId));
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      // Malformed blob — treat as a miss rather than serving garbage.
      return undefined;
    }
  }
}

/** Thin factory mirroring core's backend factories. */
export function createMinioSnapshotStore(blob: BlobStore): MinioSnapshotStore {
  return new MinioSnapshotStore(blob);
}
