import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BraveSearchAdapter,
  BraveSearchError,
} from "../../src/search/braveSearchAdapter.js";

function braveOk(results: Array<{ title: string; url: string; description: string; age?: string }>): Response {
  return new Response(JSON.stringify({ web: { results } }), { status: 200 });
}

describe("BraveSearchAdapter (stubbed fetch — key-free)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("GETs the brave endpoint with X-Subscription-Token, count, and freshness", async () => {
    const fetchSpy = vi.fn(async (url: URL | string, init: RequestInit) => {
      const u = new URL(String(url));
      expect(`${u.origin}${u.pathname}`).toBe(
        "https://api.search.brave.com/res/v1/web/search",
      );
      expect(u.searchParams.get("q")).toBe("hello world");
      expect(u.searchParams.get("count")).toBe("5");
      expect(u.searchParams.get("freshness")).toBe("pw");
      expect((init.headers as Record<string, string>)["X-Subscription-Token"]).toBe(
        "test-key",
      );
      return braveOk([
        { title: "T", url: "https://x.test", description: "d", age: "2h" },
      ]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await new BraveSearchAdapter("test-key").search("hello world", {
      limit: 5,
      freshness: "week",
    });
    expect(res.source).toBe("brave");
    expect(res.results[0]).toEqual({
      title: "T",
      url: "https://x.test",
      snippet: "d",
      publishedAt: "2h",
    });
  });

  it("defaults count to 10 and omits freshness when not set; empty web -> []", async () => {
    const fetchSpy = vi.fn(async (url: URL | string) => {
      const u = new URL(String(url));
      expect(u.searchParams.get("count")).toBe("10");
      expect(u.searchParams.get("freshness")).toBeNull();
      return braveOk([]);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const res = await new BraveSearchAdapter("k").search("q");
    expect(res.results).toEqual([]);
  });

  it("throws BraveSearchError(statusCode) on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 429 })));
    let caught: unknown;
    try {
      await new BraveSearchAdapter("k").search("q");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BraveSearchError);
    expect((caught as BraveSearchError).statusCode).toBe(429);
  });
});
