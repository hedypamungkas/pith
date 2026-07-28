import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScrapeUrlResult } from "@use-pith/core";
import type { BlobStore } from "../../src/blobStore.js";
import { minioFromEnv } from "../helpers/minio.js";
import { pgFromEnv, type PgHandle } from "../helpers/pg.js";
import { MinioFreshnessCache } from "../../src/freshnessCache.js";

const GATED =
  !process.env.MINIO_ENDPOINT || !process.env.PG_DATABASE_URL;

// Real Postgres (metadata) + real MinIO (body). Gated — needs both.
describe.skipIf(GATED)("MinioFreshnessCache (real PG + MinIO)", () => {
  let pg: PgHandle;
  let blob: BlobStore;
  let cache: MinioFreshnessCache;

  beforeAll(async () => {
    blob = await minioFromEnv();
    pg = await pgFromEnv();
    cache = new MinioFreshnessCache(pg.client, blob);
  });
  afterAll(async () => {
    await pg.close();
  });

  const url = `https://fresh-it-${process.pid}.test`;
  const crawledAt = new Date("2026-01-01T00:00:00Z");
  const content: ScrapeUrlResult = {
    finalUrl: url,
    title: "T",
    markdown: "x",
    text: "x",
    html: "",
    statusCode: 200,
    fetchedAt: "2026-01-01T00:00:00.000Z",
    tierUsed: "static",
    attempts: [{ tier: "static", success: true }],
  };

  it("concurrent records converge on the tighter tier; body in MinIO, metadata in PG", async () => {
    await Promise.all([
      cache.record({ url, crawledAt, content, requestedTier: "standard", requestedTierMaxStalenessSeconds: 86400, requestedTierProactiveRecrawl: false }),
      cache.record({ url, crawledAt, content, requestedTier: "news", requestedTierMaxStalenessSeconds: 3600, requestedTierProactiveRecrawl: true }),
      cache.record({ url, crawledAt, content, requestedTier: "standard", requestedTierMaxStalenessSeconds: 86400, requestedTierProactiveRecrawl: false }),
    ]);
    const r = await cache.tryGet(url);
    expect(r?.watchedTier).toBe("news");
    expect(r?.watchedTierMaxStalenessSeconds).toBe(3600);
    expect(r?.content.markdown).toBe("x"); // rehydrated from MinIO
  });
});
