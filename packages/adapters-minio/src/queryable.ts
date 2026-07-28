/**
 * The minimal Postgres client surface the composite {@link MinioFreshnessCache}
 * needs for its `freshness_meta` metadata: a `query` (plus `tx` for parity with
 * `@use-pith/adapters-pg`'s seam). Declared LOCALLY and STRUCTURALLY so this
 * package does not force a type-level dependency on `@use-pith/adapters-pg`:
 *
 *  - any `PgPoolQueryable` from `@use-pith/adapters-pg` satisfies it, and
 *  - the PGlite test double (`PgliteQueryable`) satisfies it, but
 *  - a host who installs `@use-pith/adapters-minio` only for the pure-MinIO
 *    stores (`MinioContentStore` / `MinioSnapshotStore`) never has to resolve
 *    the optional peer's types through the barrel.
 *
 * `@use-pith/adapters-pg` remains an optional *runtime* peer — it is where you
 * get a real `Queryable` implementation (`PgPoolQueryable`) — but its types no
 * longer leak into this package's emitted `.d.ts`.
 */
export interface Queryable {
  query<R = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[] }>;
  tx<R>(fn: (q: Queryable) => Promise<R>): Promise<R>;
}
