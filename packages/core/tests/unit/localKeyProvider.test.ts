import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { LocalKeyProvider } from "../../src/auth/localKeyProvider.js";

describe("LocalKeyProvider", () => {
  it("returns the raw key for a configured version", async () => {
    const key = randomBytes(32);
    const provider = new LocalKeyProvider(new Map([[1, key]]));
    expect(await provider.unwrapDek(1)).toEqual(key);
  });

  it("returns null for an unconfigured version (so the factory falls back)", async () => {
    const provider = new LocalKeyProvider(new Map([[1, randomBytes(32)]]));
    expect(await provider.unwrapDek(2)).toBeNull();
  });

  it("never performs I/O — unwrap is a plain map lookup", async () => {
    const key = randomBytes(32);
    const provider = new LocalKeyProvider(new Map([[7, key]]));
    expect(await provider.unwrapDek(7)).toEqual(key);
  });
});
