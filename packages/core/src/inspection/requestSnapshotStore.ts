/** The large response fields, stored as one JSON bundle per request. Mirrors
 *  the freshness-cache content shape, plus the raw HTML (which the scrape path
 *  otherwise discards — replay needs it to compare the actual fetched page, not
 *  just its markdown rendering). */
export interface RequestSnapshotBody {
  markdown: string;
  text: string;
  html: string;
  title: string | null;
}

/** request-snapshots/<requestId>.json — requestId is a server-generated UUID
 *  (object-key-safe), so no hashing is needed. Pure key builder; the actual
 *  blob put/get lives behind the SnapshotStore port (InMemorySnapshotStore by
 *  default, MinIO adapter in prod) — the host's putSnapshotBody/getSnapshotBody
 *  are an optional adapter, not part of the core. */
export function objectKeyForRequestSnapshot(requestId: string): string {
  return `request-snapshots/${requestId}.json`;
}
