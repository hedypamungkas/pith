/**
 * @use-pith/adapters-minio — S3/MinIO adapters for the Pith CorePorts.
 *
 * Offloads bulky payloads to object storage:
 *  - `MinioContentStore` (`ContentStore`) — page-content blobs (pure MinIO).
 *  - `MinioSnapshotStore` (`SnapshotStore`) — whole snapshot as one object
 *    (pure MinIO; alternative to the inline `PgSnapshotStore`).
 *  - `MinioFreshnessCache` (`FreshnessCache`) — composite: lean queryable
 *    metadata in Postgres + bulky `content` in MinIO.
 *
 * Compose exactly like the in-memory defaults / the PG adapters:
 *
 *   import { createEngine } from "@use-pith/core";
 *   import { createMinioBlobStore, MinioContentStore, MinioSnapshotStore } from "@use-pith/adapters-minio";
 *
 *   const blob = createMinioBlobStore({ endPoint: "minio", port: 9000, accessKey, secretKey, bucket: "pith" });
 *   await blob.ensureBucket();
 *   createEngine({ contentStore: new MinioContentStore(blob), snapshotStore: new MinioSnapshotStore(blob), ... });
 *
 * `minio` is a dependency of THIS package only — core never imports it (enforced
 * by the core smoke gate). `@use-pith/core` is a peer; `@use-pith/adapters-pg`
 * is an OPTIONAL peer (only `MinioFreshnessCache` needs a Postgres `Queryable`).
 */

export { MinioBlobStore, createMinioBlobStore } from "./blobStore.js";
export type { BlobStore, MinioBlobStoreOptions } from "./blobStore.js";
export { MinioContentStore, createMinioContentStore } from "./contentStore.js";
export { MinioSnapshotStore, createMinioSnapshotStore } from "./snapshotStore.js";
export {
  MinioFreshnessCache,
  createMinioFreshnessCache,
} from "./freshnessCache.js";
export { runMigrations } from "./migrate.js";
export { freshnessObjectKey } from "./util.js";
