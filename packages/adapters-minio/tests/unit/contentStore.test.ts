import { describe, it, expect, beforeEach } from "vitest";
import { FakeMinioStore } from "../helpers/fakeMinio.js";
import { MinioContentStore } from "../../src/contentStore.js";

describe("MinioContentStore", () => {
  let store: MinioContentStore;
  beforeEach(() => {
    store = new MinioContentStore(new FakeMinioStore());
  });

  it("put + get round-trips a content blob", async () => {
    await store.put("crawl-pages/c1/1.md", "# Hello");
    expect(await store.get("crawl-pages/c1/1.md")).toBe("# Hello");
  });

  it("get returns undefined for a missing key", async () => {
    expect(await store.get("crawl-pages/missing.md")).toBeUndefined();
  });

  it("list returns keys under a prefix", async () => {
    await store.put("crawl-pages/c1/1.md", "a");
    await store.put("crawl-pages/c1/2.md", "b");
    await store.put("request-snapshots/x.json", "c");
    expect(await store.list("crawl-pages/c1/")).toEqual([
      "crawl-pages/c1/1.md",
      "crawl-pages/c1/2.md",
    ]);
  });

  it("delete removes a blob", async () => {
    await store.put("crawl-pages/c1/1.md", "a");
    await store.delete("crawl-pages/c1/1.md");
    expect(await store.get("crawl-pages/c1/1.md")).toBeUndefined();
  });

  it("overwrites on re-put (upsert by key)", async () => {
    await store.put("crawl-pages/c1/1.md", "v1");
    await store.put("crawl-pages/c1/1.md", "v2");
    expect(await store.get("crawl-pages/c1/1.md")).toBe("v2");
  });
});
