import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { bufferStream, freshnessObjectKey, isNotFound, toDate } from "../../src/util.js";

describe("freshnessObjectKey", () => {
  it("is stable for a given url and follows the freshness/<sha256>.json shape", () => {
    const url = "https://example.test/a?b=c";
    const key = freshnessObjectKey(url);
    expect(key).toMatch(/^freshness\/[0-9a-f]{64}\.json$/);
    // Deterministic: same url → same key.
    expect(freshnessObjectKey(url)).toBe(key);
  });

  it("differs across urls", () => {
    expect(freshnessObjectKey("https://a.test")).not.toBe(
      freshnessObjectKey("https://b.test"),
    );
  });
});

describe("isNotFound", () => {
  const truthy = [
    { code: "NoSuchKey" },
    { code: "NotFound" },
    { name: "NoSuchKey" },
    { name: "NotFound" },
    { statusCode: 404 },
    { status: 404 },
    Object.assign(new Error("x"), { code: "NoSuchKey" }),
  ];
  const falsy = [
    null,
    undefined,
    "NoSuchKey",
    42,
    {},
    { code: "AccessDenied" },
    { statusCode: 500 },
    new Error("boom"),
  ];
  for (const v of truthy) {
    it(`is true for ${JSON.stringify(v) ?? String(v)}`, () => {
      expect(isNotFound(v)).toBe(true);
    });
  }
  for (const v of falsy) {
    it(`is false for ${JSON.stringify(v) ?? String(v)}`, () => {
      expect(isNotFound(v)).toBe(false);
    });
  }
});

describe("toDate", () => {
  it("passes a Date through (same instant)", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    expect(toDate(d).getTime()).toBe(d.getTime());
  });

  it("returns an Invalid Date for null/undefined", () => {
    expect(Number.isNaN(toDate(null).getTime())).toBe(true);
    expect(Number.isNaN(toDate(undefined).getTime())).toBe(true);
  });

  it("parses an ISO string", () => {
    expect(toDate("2026-01-01T00:00:00Z").getTime()).toBe(
      new Date("2026-01-01T00:00:00Z").getTime(),
    );
  });

  it("parses an epoch number", () => {
    const ms = Date.parse("2026-01-01T00:00:00Z");
    expect(toDate(ms).getTime()).toBe(ms);
  });
});

describe("bufferStream", () => {
  it("concatenates string chunks to a utf-8 string", async () => {
    expect(await bufferStream(Readable.from(["he", "llo"]))).toBe("hello");
  });

  it("concatenates Buffer chunks", async () => {
    expect(
      await bufferStream(Readable.from([Buffer.from("ab"), Buffer.from("cd")])),
    ).toBe("abcd");
  });
});
