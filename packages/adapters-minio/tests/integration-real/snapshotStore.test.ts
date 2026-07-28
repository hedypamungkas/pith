import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BlobStore } from "../../src/blobStore.js";
import { minioFromEnv } from "../helpers/minio.js";
import { MinioSnapshotStore } from "../../src/snapshotStore.js";
import { objectKeyForRequestSnapshot } from "@use-pith/core";

// Real MinIO. Gated — skipped unless MINIO_ENDPOINT is set.
describe.skipIf(!process.env.MINIO_ENDPOINT)(
  "MinioSnapshotStore (real MinIO)",
  () => {
    let blob: BlobStore;
    let store: MinioSnapshotStore;
    const rids: string[] = [];

    beforeAll(async () => {
      blob = await minioFromEnv();
      store = new MinioSnapshotStore(blob);
    });
    afterAll(async () => {
      for (const rid of rids) await blob.delete(objectKeyForRequestSnapshot(rid));
    });

    it("capture + load round-trips a snapshot against real MinIO", async () => {
      const rid = `snap-${process.pid}-${Math.random().toString(36).slice(2)}`;
      rids.push(rid);
      const snap = {
        requestId: rid,
        operation: "crawl_page",
        url: "https://x.test/",
        body: { markdown: "# A", text: "A", html: "<p>A</p>", title: "A" },
      };
      await store.capture(snap);
      expect(await store.load(rid)).toEqual(snap);
    });

    it("load returns undefined for an unknown requestId", async () => {
      expect(await store.load("does-not-exist")).toBeUndefined();
    });
  },
);
