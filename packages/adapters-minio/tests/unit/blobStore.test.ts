import { describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import type * as Minio from "minio";
import { MinioBlobStore } from "../../src/blobStore.js";

/**
 * Container-free coverage of {@link MinioBlobStore} — the only class that wraps
 * a real `minio.Client`. A hand-rolled fake client (no network) exercises the
 * adapter's OWN logic: prefix prepend/strip, dual-site NotFound, ensureBucket
 * idempotency. This is the object-store analog of PGlite for the PG adapters.
 */
function fakeClient() {
  const state = {
    buckets: new Set<string>(),
    objects: new Map<string, Buffer>(),
  };
  const fns = {
    bucketExists: vi.fn(async (bucket: string) => state.buckets.has(bucket)),
    makeBucket: vi.fn(async (bucket: string) => {
      state.buckets.add(bucket);
    }),
    putObject: vi.fn(async (bucket: string, key: string, body: Buffer) => {
      state.objects.set(`${bucket}/${key}`, Buffer.from(body));
    }),
    getObject: vi.fn((bucket: string, key: string) => {
      const buf = state.objects.get(`${bucket}/${key}`);
      if (!buf) {
        // minio rejects the getObject promise for a missing key.
        return Promise.reject(
          Object.assign(new Error("The specified key does not exist."), {
            code: "NoSuchKey",
          }),
        );
      }
      return Promise.resolve(Readable.from([buf]));
    }),
    listObjects: vi.fn((bucket: string, prefix: string) => {
      const names = [...state.objects.keys()]
        .filter((k) => k.startsWith(`${bucket}/${prefix}`))
        .map((k) => k.slice(`${bucket}/`.length));
      return Readable.from(names.map((name) => ({ name })));
    }),
    removeObject: vi.fn(async (bucket: string, key: string) => {
      state.objects.delete(`${bucket}/${key}`);
    }),
  };
  return { client: fns as unknown as Minio.Client, fns, state };
}

describe("MinioBlobStore", () => {
  it("ensureBucket creates the bucket once and is idempotent", async () => {
    const { client, fns } = fakeClient();
    const store = new MinioBlobStore(client, "pith", "pfx/");
    await store.ensureBucket();
    expect(fns.makeBucket).toHaveBeenCalledTimes(1);
    // Second call: bucket now exists → makeBucket must NOT run again.
    await store.ensureBucket();
    expect(fns.makeBucket).toHaveBeenCalledTimes(1);
  });

  it("put stores the body as a Buffer and get round-trips string + Uint8Array", async () => {
    const { client } = fakeClient();
    const store = new MinioBlobStore(client, "pith", "");
    await store.put("a.txt", "hello");
    expect(await store.get("a.txt")).toBe("hello");
    await store.put("b.bin", new Uint8Array([104, 105])); // "hi"
    expect(await store.get("b.bin")).toBe("hi");
  });

  it("get returns undefined when getObject rejects with NotFound (reject path)", async () => {
    const { client } = fakeClient();
    const store = new MinioBlobStore(client, "pith", "");
    expect(await store.get("missing")).toBeUndefined();
  });

  it("get returns undefined when the stream errors mid-stream with NotFound", async () => {
    const { client, fns } = fakeClient();
    // Simulate the client-version variant where getObject resolves but the
    // stream rejects with NoSuchKey during iteration.
    fns.getObject.mockImplementationOnce(() =>
      Promise.resolve(
        Readable.from(
          (async function* () {
            throw Object.assign(new Error("NoSuchKey"), { code: "NoSuchKey" });
          })(),
        ),
      ),
    );
    const store = new MinioBlobStore(client, "pith", "");
    expect(await store.get("late-missing")).toBeUndefined();
  });

  it("get rethrows non-NotFound errors", async () => {
    const { client, fns } = fakeClient();
    fns.getObject.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error("AccessDenied"), { code: "AccessDenied" })),
    );
    const store = new MinioBlobStore(client, "pith", "");
    await expect(store.get("denied")).rejects.toThrow("AccessDenied");
  });

  it("list queries under the composed prefix and strips the store prefix", async () => {
    const { client, fns } = fakeClient();
    const store = new MinioBlobStore(client, "pith", "pfx/");
    await store.put("crawl-pages/c1/p1.md", "x");
    await store.put("crawl-pages/c1/p2.md", "y");
    await store.put("other/o.md", "z");
    const keys = await store.list("crawl-pages/c1/");
    // Server-side filter was asked for "pfx/crawl-pages/c1/".
    expect(fns.listObjects).toHaveBeenCalledWith("pith", "pfx/crawl-pages/c1/", true);
    // Caller sees logical keys (store prefix stripped).
    expect(keys).toEqual(["crawl-pages/c1/p1.md", "crawl-pages/c1/p2.md"]);
  });

  it("list with no store prefix returns keys verbatim", async () => {
    const { client } = fakeClient();
    const store = new MinioBlobStore(client, "pith", "");
    await store.put("k1", "a");
    await store.put("k2", "b");
    expect((await store.list("")).sort()).toEqual(["k1", "k2"]);
  });

  it("delete removes the object", async () => {
    const { client } = fakeClient();
    const store = new MinioBlobStore(client, "pith", "");
    await store.put("gone", "x");
    expect(await store.get("gone")).toBe("x");
    await store.delete("gone");
    expect(await store.get("gone")).toBeUndefined();
  });
});
