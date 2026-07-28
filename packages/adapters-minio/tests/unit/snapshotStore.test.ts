import { describe, it, expect, beforeEach } from "vitest";
import { objectKeyForRequestSnapshot } from "@use-pith/core";
import { FakeMinioStore } from "../helpers/fakeMinio.js";
import { MinioSnapshotStore } from "../../src/snapshotStore.js";

describe("MinioSnapshotStore", () => {
  let blob: FakeMinioStore;
  let store: MinioSnapshotStore;
  beforeEach(() => {
    blob = new FakeMinioStore();
    store = new MinioSnapshotStore(blob);
  });

  it("capture + load round-trips a snapshot by requestId", async () => {
    const snap = {
      requestId: "r1",
      operation: "crawl_page",
      url: "https://x.test/",
      tierUsed: "static",
      statusCode: 200,
      body: { markdown: "# A", text: "A", html: "<p>A</p>", title: "A" },
    };
    await store.capture(snap);
    expect(await store.load("r1")).toEqual(snap);
  });

  it("capture is a no-op without a requestId", async () => {
    await store.capture({ foo: "bar" });
    expect(await store.load("r1")).toBeUndefined();
  });

  it("load returns undefined for an unknown requestId", async () => {
    expect(await store.load("nope")).toBeUndefined();
  });

  it("overwrites on re-capture (upsert by requestId)", async () => {
    await store.capture({ requestId: "r1", url: "https://a.test/" });
    await store.capture({ requestId: "r1", url: "https://b.test/" });
    const loaded = (await store.load("r1")) as { url: string };
    expect(loaded.url).toBe("https://b.test/");
  });

  it("load returns undefined for a malformed blob (miss, not garbage)", async () => {
    await blob.put(objectKeyForRequestSnapshot("r1"), "{not json");
    expect(await store.load("r1")).toBeUndefined();
  });

  it("capture is a no-op for null / non-objects / non-string requestId", async () => {
    await store.capture(null);
    await store.capture(undefined);
    await store.capture(42);
    await store.capture("nope");
    await store.capture({ requestId: 123 }); // non-string requestId → rejected
    // Only a string-requestId snapshot should land.
    await store.capture({ requestId: "r1", body: "ok" });
    const loaded = (await store.load("r1")) as { body: string };
    expect(loaded.body).toBe("ok");
  });
});
