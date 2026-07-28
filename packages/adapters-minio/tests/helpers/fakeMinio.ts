import type { BlobStore } from "../../src/blobStore.js";

/**
 * An in-memory {@link BlobStore} — the MinIO analog of PGlite. MinIO has no
 * in-process equivalent, so the adapter unit tests use this fake (a `Map`) to
 * exercise the real adapter logic with zero containers. The key-free `unit`
 * project stays container-free; real MinIO is exercised only in the gated
 * `integration-real` suite.
 *
 * Mirrors {@link MinioBlobStore}'s contract: bodies are utf-8 text; `get` on a
 * missing key returns `undefined`; `list(prefix)` returns logical keys.
 */
export class FakeMinioStore implements BlobStore {
  private readonly store = new Map<string, string>();

  async put(key: string, body: string | Uint8Array): Promise<void> {
    this.store.set(
      key,
      typeof body === "string" ? body : Buffer.from(body).toString("utf8"),
    );
  }

  async get(key: string): Promise<string | undefined> {
    return this.store.get(key);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.store.keys()].filter((k) => k.startsWith(prefix)).sort();
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** Test introspection. */
  has(key: string): boolean {
    return this.store.has(key);
  }

  size(): number {
    return this.store.size;
  }
}
