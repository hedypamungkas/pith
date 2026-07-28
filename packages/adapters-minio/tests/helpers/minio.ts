import { createMinioBlobStore } from "../../src/index.js";
import type { BlobStore } from "../../src/blobStore.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Build a real {@link BlobStore} (`MinioBlobStore`) from `MINIO_*` env and
 * ensure the bucket exists. For the gated `integration-real` suite only — the
 * `unit` suite uses FakeMinioStore (no container). Retries `ensureBucket`
 * because the minio container may still be starting (the image has no
 * healthcheck command).
 */
export async function minioFromEnv(): Promise<BlobStore> {
  const endPoint = process.env.MINIO_ENDPOINT;
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY;
  const bucket = process.env.MINIO_BUCKET;
  if (!endPoint || !accessKey || !secretKey || !bucket) {
    throw new Error(
      "MINIO_ENDPOINT / MINIO_ACCESS_KEY / MINIO_SECRET_KEY / MINIO_BUCKET are not set",
    );
  }
  const port = process.env.MINIO_PORT ? Number(process.env.MINIO_PORT) : undefined;
  const useSSL = process.env.MINIO_USE_SSL === "true";
  const blob = createMinioBlobStore({
    endPoint,
    port,
    useSSL,
    accessKey,
    secretKey,
    bucket,
  });
  let lastErr: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      await blob.ensureBucket();
      return blob;
    } catch (err) {
      lastErr = err;
      await sleep(1000);
    }
  }
  throw new Error(
    `minio not reachable at ${endPoint}:${port ?? "(default)"}: ${
      (lastErr as Error).message
    }`,
  );
}
