import * as Minio from "minio";
import { bufferStream, isNotFound } from "./util.js";

/**
 * The minimal object-store surface the MinIO adapters depend on — structurally
 * identical to {@link ContentStore} (`put`/`get`/`list`/`delete`). The interface
 * itself is plain TypeScript (no `minio` types); `MinioContentStore` *is* a
 * BlobStore over a bucket, and the snapshot/freshness offload adapters reuse it
 * for body put/get. Only the concrete {@link MinioBlobStore} pulls in the
 * `minio` client — the interface (and its consumers) never import `minio` or
 * core.
 */
export interface BlobStore {
  put(key: string, body: string | Uint8Array): Promise<void>;
  get(key: string): Promise<string | undefined>;
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}

export interface MinioBlobStoreOptions {
  endPoint: string;
  port?: number;
  useSSL?: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
  /** Prefix prepended to every object key (e.g. `pith/`). Stripped from `list`
   *  results so callers see logical keys. */
  prefix?: string;
}

/**
 * Wraps a `minio.Client` as a {@link BlobStore}. Constructed with an explicit,
 * already-built client (mirrors `PgPoolQueryable` wrapping a `pg.Pool`) — no
 * singleton, no env reads. The host owns the client and ensures the bucket
 * exists (see {@link ensureBucket}, or create the bucket out-of-band).
 *
 * Bodies are stored and returned as utf-8 strings — the OSS content (page
 * markdown, JSON snapshots) is always text. Not for arbitrary binary blobs.
 */
export class MinioBlobStore implements BlobStore {
  constructor(
    private readonly client: Minio.Client,
    private readonly bucket: string,
    private readonly prefix = "",
  ) {}

  /** Create the bucket if it doesn't exist (idempotent). Call once at boot. */
  async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) await this.client.makeBucket(this.bucket);
  }

  private key(k: string): string {
    return this.prefix + k;
  }

  async put(key: string, body: string | Uint8Array): Promise<void> {
    const buf = typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
    await this.client.putObject(this.bucket, this.key(key), buf, buf.length);
  }

  async get(key: string): Promise<string | undefined> {
    let stream: NodeJS.ReadableStream;
    try {
      stream = await this.client.getObject(this.bucket, this.key(key));
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
    try {
      return await bufferStream(stream as import("node:stream").Readable);
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const names: string[] = [];
    const stream = this.client.listObjects(this.bucket, this.key(prefix), true);
    for await (const obj of stream) {
      const name = (obj as { name?: string }).name;
      if (!name) continue;
      names.push(
        this.prefix && name.startsWith(this.prefix)
          ? name.slice(this.prefix.length)
          : name,
      );
    }
    return names;
  }

  async delete(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, this.key(key));
  }
}

/** Convenience factory: build a `minio.Client` from explicit options and wrap
 *  it. Mirrors core's `createExtractionBackend` / `createBraveSearchBackend`. */
export function createMinioBlobStore(opts: MinioBlobStoreOptions): MinioBlobStore {
  const client = new Minio.Client({
    endPoint: opts.endPoint,
    port: opts.port,
    useSSL: opts.useSSL ?? false,
    accessKey: opts.accessKey,
    secretKey: opts.secretKey,
  });
  return new MinioBlobStore(client, opts.bucket, opts.prefix);
}
