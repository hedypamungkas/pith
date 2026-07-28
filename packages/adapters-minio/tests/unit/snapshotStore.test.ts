import { describe, it, expect, beforeEach } from "vitest";
import { FakeMinioStore } from "../helpers/fakeMinio.js";
import { MinioSnapshotStore } from "../../src/snapshotStore.js";

describe("MinioSnapshotStore", () => {
  let store: MinioSnapshotStore;
  beforeEach(() => {
    store = new MinioSnapshotStore(new FakeMinioStore());
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
});
