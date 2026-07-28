import { createHash } from "node:crypto";
import type { Readable } from "node:stream";

/**
 * Object key for a freshness content blob: `freshness/<sha256(url)>.json`. URLs
 * aren't object-key-safe (`/`, `:`, `?`, …), so hash to a fixed-length hex key.
 * (Snapshot bodies key off a requestId UUID, which is already key-safe — no
 * hash needed there.)
 */
export function freshnessObjectKey(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex");
  return `freshness/${hash}.json`;
}

/** Buffer a readable byte stream to a utf-8 string. */
export async function bufferStream(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** True for MinIO/S3 "object not found" errors. `getObject` on a missing key
 *  can reject the promise OR error mid-stream depending on the client version,
 *  so callers check at both sites. */
export function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return code === "NoSuchKey" || code === "NotFound";
}

/** Coerce a timestamptz column value into a JS Date. `pg` returns timestamptz
 *  as Date; PGlite may return a Date or ISO string. Both share the instant. */
export function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value === null || value === undefined) return new Date(NaN);
  return new Date(value as string);
}
