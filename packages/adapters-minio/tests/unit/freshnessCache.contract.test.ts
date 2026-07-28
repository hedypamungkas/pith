import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ScrapeUrlResult } from "@use-pith/core";
import { makePglite, type PgliteHandle } from "../helpers/pglite.js";
import { FakeMinioStore } from "../helpers/fakeMinio.js";
import type { BlobStore } from "../../src/blobStore.js";
import { MinioFreshnessCache } from "../../src/freshnessCache.js";
import { freshnessObjectKey } from "../../src/util.js";

/** A BlobStore that delegates everything to `inner` except `delete`, which
 *  rejects with a non-NotFound error — to exercise the retryable erase path. */
function failingDeleteBlob(inner: FakeMinioStore): BlobStore {
  return {
    put: (k, b) => inner.put(k, b),
    get: (k) => inner.get(k),
    list: (p) => inner.list(p),
    delete: async () => {
      throw Object.assign(new Error("AccessDenied"), { code: "AccessDenied" });
    },
  };
}

let pg: PgliteHandle;
let blob: FakeMinioStore;

beforeEach(async () => {
  pg = await makePglite();
  blob = new FakeMinioStore();
});
afterEach(async () => {
  await pg.close();
});

const T0 = new Date("2026-01-01T00:00:00Z");

function content(markdown: string): ScrapeUrlResult {
  return {
    finalUrl: "https://x.test",
    title: "T",
    markdown,
    text: markdown,
    html: "",
    statusCode: 200,
    fetchedAt: T0.toISOString(),
    tierUsed: "static",
    attempts: [{ tier: "static", success: true }],
  };
}

// Contract parity with @use-pith/core's InMemoryFreshnessCache and
// @use-pith/adapters-pg's PgFreshnessCache — same behaviors, real SQL on PGlite
// for metadata + FakeMinioStore for the body. No container.
describe("MinioFreshnessCache (contract parity)", () => {
  it("tryGet returns null for an unseen URL", async () => {
    const cache = new MinioFreshnessCache(pg.client, blob);
    expect(await cache.tryGet("https://nope.test")).toBeNull();
  });

  it("record + tryGet round-trips the content from object storage", async () => {
    const cache = new MinioFreshnessCache(pg.client, blob);
    await cache.record({
      url: "https://x.test",
      requestedTier: "news",
      requestedTierMaxStalenessSeconds: 3600,
      requestedTierProactiveRecrawl: true,
      crawledAt: T0,
      content: content("# A"),
    });
    // The body is NOT in Postgres — it's in the blob store.
    expect(blob.size()).toBe(1);
    const r = await cache.tryGet("https://x.test");
    expect(r?.content.markdown).toBe("# A");
    expect(r?.watchedTier).toBe("news");
    expect(r?.nextDueAt).toEqual(new Date(T0.getTime() + 3600 * 1000));
  });

  it("tightens monotonically: a stricter tier is adopted, a looser one is rejected", async () => {
    const cache = new MinioFreshnessCache(pg.client, blob);
    await cache.record({
      url: "https://x.test",
      requestedTier: "standard",
      requestedTierMaxStalenessSeconds: 86400,
      requestedTierProactiveRecrawl: false,
      crawledAt: T0,
      content: content("# standard"),
    });
    expect((await cache.tryGet("https://x.test"))?.watchedTier).toBe("standard");

    await cache.record({
      url: "https://x.test",
      requestedTier: "news",
      requestedTierMaxStalenessSeconds: 3600,
      requestedTierProactiveRecrawl: true,
      crawledAt: T0,
      content: content("# news"),
    });
    let r = await cache.tryGet("https://x.test");
    expect(r?.watchedTier).toBe("news");
    expect(r?.watchedTierMaxStalenessSeconds).toBe(3600);

    await cache.record({
      url: "https://x.test",
      requestedTier: "standard",
      requestedTierMaxStalenessSeconds: 86400,
      requestedTierProactiveRecrawl: false,
      crawledAt: T0,
      content: content("# standard-again"),
    });
    r = await cache.tryGet("https://x.test");
    expect(r?.watchedTier).toBe("news");
    expect(r?.watchedTierMaxStalenessSeconds).toBe(3600);
    // content still refreshed even though the tier wasn't adopted
    expect(r?.content.markdown).toBe("# standard-again");
  });

  it("listDue returns only proactive URLs past their nextDueAt", async () => {
    const cache = new MinioFreshnessCache(pg.client, blob);
    await cache.record({
      url: "https://news.test",
      requestedTier: "news",
      requestedTierMaxStalenessSeconds: 3600,
      requestedTierProactiveRecrawl: true,
      crawledAt: T0,
      content: content("# news"),
    });
    await cache.record({
      url: "https://std.test",
      requestedTier: "standard",
      requestedTierMaxStalenessSeconds: 1,
      requestedTierProactiveRecrawl: false,
      crawledAt: T0,
      content: content("# std"),
    });
    expect(await cache.listDue(new Date(T0.getTime() + 1800 * 1000))).toEqual([]);
    expect(await cache.listDue(new Date(T0.getTime() + 4000 * 1000))).toEqual([
      { url: "https://news.test", watchedTier: "news" },
    ]);
  });

  it("delete erases the metadata row and the body blob, reports existence", async () => {
    const cache = new MinioFreshnessCache(pg.client, blob);
    await cache.record({
      url: "https://x.test",
      requestedTier: "news",
      requestedTierMaxStalenessSeconds: 3600,
      requestedTierProactiveRecrawl: true,
      crawledAt: T0,
      content: content("# A"),
    });
    expect(blob.size()).toBe(1);
    expect(await cache.delete("https://x.test")).toBe(true);
    expect(await cache.tryGet("https://x.test")).toBeNull();
    expect(blob.size()).toBe(0); // blob cleaned up
    expect(await cache.delete("https://x.test")).toBe(false);
  });

  it("tryGet returns null when the metadata row exists but the body blob is missing", async () => {
    const cache = new MinioFreshnessCache(pg.client, blob);
    const url = "https://x.test";
    await cache.record({
      url,
      requestedTier: "news",
      requestedTierMaxStalenessSeconds: 3600,
      requestedTierProactiveRecrawl: true,
      crawledAt: T0,
      content: content("# A"),
    });
    // Simulate external blob loss (e.g. a partial DSAR erase): drop only the body.
    await blob.delete(freshnessObjectKey(url));
    expect(await cache.tryGet(url)).toBeNull();
  });

  it("tryGet returns null for a present-but-malformed body (self-healing miss)", async () => {
    const cache = new MinioFreshnessCache(pg.client, blob);
    const url = "https://corrupt.test";
    await cache.record({
      url,
      requestedTier: "news",
      requestedTierMaxStalenessSeconds: 3600,
      requestedTierProactiveRecrawl: true,
      crawledAt: T0,
      content: content("# A"),
    });
    // Corrupt the body blob in place (partial write / tampering).
    await blob.put(freshnessObjectKey(url), "{not json");
    expect(await cache.tryGet(url)).toBeNull();
  });

  it("tryGet returns null when the body parses but lacks a string markdown", async () => {
    const cache = new MinioFreshnessCache(pg.client, blob);
    const url = "https://badshape.test";
    await cache.record({
      url,
      requestedTier: "news",
      requestedTierMaxStalenessSeconds: 3600,
      requestedTierProactiveRecrawl: true,
      crawledAt: T0,
      content: content("# A"),
    });
    await blob.put(freshnessObjectKey(url), JSON.stringify({ markdown: 123 }));
    expect(await cache.tryGet(url)).toBeNull();
  });

  it("concurrent records converge on the tighter tier (body in the blob, metadata in PG)", async () => {
    const cache = new MinioFreshnessCache(pg.client, blob);
    const url = "https://concurrent.test";
    await Promise.all([
      cache.record({
        url,
        requestedTier: "standard",
        requestedTierMaxStalenessSeconds: 86400,
        requestedTierProactiveRecrawl: false,
        crawledAt: T0,
        content: content("# s1"),
      }),
      cache.record({
        url,
        requestedTier: "news",
        requestedTierMaxStalenessSeconds: 3600,
        requestedTierProactiveRecrawl: true,
        crawledAt: T0,
        content: content("# n"),
      }),
      cache.record({
        url,
        requestedTier: "standard",
        requestedTierMaxStalenessSeconds: 86400,
        requestedTierProactiveRecrawl: false,
        crawledAt: T0,
        content: content("# s2"),
      }),
    ]);
    const r = await cache.tryGet(url);
    expect(r?.watchedTier).toBe("news");
    expect(r?.watchedTierMaxStalenessSeconds).toBe(3600);
  });

  it("a later, non-adopted record still refreshes crawledAt/nextDueAt (recomputed from the tighter max)", async () => {
    const cache = new MinioFreshnessCache(pg.client, blob);
    const url = "https://later.test";
    // Tighten to news/3600 first.
    await cache.record({
      url,
      requestedTier: "news",
      requestedTierMaxStalenessSeconds: 3600,
      requestedTierProactiveRecrawl: true,
      crawledAt: T0,
      content: content("# n"),
    });
    // A later, looser record: tier NOT adopted, but crawledAt/nextDueAt/body refresh.
    const later = new Date(T0.getTime() + 10_000);
    await cache.record({
      url,
      requestedTier: "standard",
      requestedTierMaxStalenessSeconds: 86400,
      requestedTierProactiveRecrawl: false,
      crawledAt: later,
      content: content("# later"),
    });
    const r = await cache.tryGet(url);
    expect(r?.watchedTier).toBe("news"); // not loosened
    expect(r?.watchedTierMaxStalenessSeconds).toBe(3600);
    expect(r?.crawledAt).toEqual(later); // refreshed to the incoming crawledAt
    expect(r?.nextDueAt).toEqual(new Date(later.getTime() + 3600 * 1000)); // later + tighter max
    expect(r?.content.markdown).toBe("# later"); // body refreshed
  });

  it("delete throws and keeps the row when the body delete fails non-NotFound — retryable", async () => {
    const inner = new FakeMinioStore();
    const cache = new MinioFreshnessCache(pg.client, failingDeleteBlob(inner));
    const url = "https://retry.test";
    await cache.record({
      url,
      requestedTier: "news",
      requestedTierMaxStalenessSeconds: 3600,
      requestedTierProactiveRecrawl: true,
      crawledAt: T0,
      content: content("# A"),
    });
    // Body delete fails → delete rejects; the metadata row stays so it can retry.
    await expect(cache.delete(url)).rejects.toThrow("AccessDenied");
    const stillThere = await cache.tryGet(url); // get still works (delegated)
    expect(stillThere?.content.markdown).toBe("# A"); // row + body still present
    // Retry with a working blob: succeeds and cleans up both sides.
    const ok = new MinioFreshnessCache(pg.client, inner);
    expect(await ok.delete(url)).toBe(true);
    expect(await ok.tryGet(url)).toBeNull();
    expect(inner.size()).toBe(0);
  });
});
