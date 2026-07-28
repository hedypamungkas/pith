import type { ContentStore } from "@use-pith/core";
import type { BlobStore } from "./blobStore.js";

/**
 * MinIO-backed {@link ContentStore} over a {@link BlobStore} (a bucket). The
 * engine already consumes this port — the crawler writes page markdown at
 * `crawl-pages/<crawlId>/<pageId>.md` (`pureCrawler.ts`), and a DSAR/content
 * enumeration scans it via `list`. This is the headline adapter: paired with
 * `@use-pith/adapters-pg`'s crawl-state, a self-hoster gets the full
 * persistence story (state in Postgres, content in object storage).
 *
 * `put`/`get`/`list`/`delete` pass straight through to the blob store; bodies
 * are utf-8 text (page markdown). Constructed with an explicit `BlobStore` —
 * no singleton, no env reads.
 */
export class MinioContentStore implements ContentStore {
  constructor(private readonly blob: BlobStore) {}

  async put(key: string, body: Uint8Array | string): Promise<void> {
    await this.blob.put(key, body);
  }

  async get(key: string): Promise<string | undefined> {
    return this.blob.get(key);
  }

  async list(prefix: string): Promise<string[]> {
    return this.blob.list(prefix);
  }

  async delete(key: string): Promise<void> {
    await this.blob.delete(key);
  }
}

/** Thin factory mirroring core's backend factories. */
export function createMinioContentStore(blob: BlobStore): MinioContentStore {
  return new MinioContentStore(blob);
}
