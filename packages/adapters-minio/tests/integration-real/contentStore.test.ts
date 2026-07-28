import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BlobStore } from "../../src/blobStore.js";
import { minioFromEnv } from "../helpers/minio.js";
import { MinioContentStore } from "../../src/contentStore.js";

// Real MinIO (not FakeMinioStore). Gated — skipped unless MINIO_ENDPOINT is set,
// so the key-free `ci.yml` matrix stays green; runs in adapters-nightly.yml.
describe.skipIf(!process.env.MINIO_ENDPOINT)(
  "MinioContentStore (real MinIO)",
  () => {
    let blob: BlobStore;
    let store: MinioContentStore;
    // Unique prefix per process so parallel/ repeat runs don't collide in the
    // shared bucket.
    const prefix = `it-content/${process.pid}-${Math.random().toString(36).slice(2)}/`;

    beforeAll(async () => {
      blob = await minioFromEnv();
      store = new MinioContentStore(blob);
    });
    afterAll(async () => {
      for (const key of await blob.list(prefix)) await blob.delete(key);
    });

    it("put + get + list + delete against real MinIO", async () => {
      await store.put(`${prefix}1.md`, "# A");
      await store.put(`${prefix}2.md`, "# B");
      expect(await store.get(`${prefix}1.md`)).toBe("# A");
      expect((await store.list(prefix)).sort()).toEqual([
        `${prefix}1.md`,
        `${prefix}2.md`,
      ]);
      await store.delete(`${prefix}1.md`);
      expect(await store.get(`${prefix}1.md`)).toBeUndefined();
    });

    it("get returns undefined for a missing key", async () => {
      expect(await store.get(`${prefix}missing.md`)).toBeUndefined();
    });

    it("accepts a Uint8Array body and returns it as text", async () => {
      const body = new TextEncoder().encode("# bytes");
      await store.put(`${prefix}bin.md`, body);
      expect(await store.get(`${prefix}bin.md`)).toBe("# bytes");
    });
  },
);
