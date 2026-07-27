import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makePglite, type PgliteHandle } from "../helpers/pglite.js";
import { PgSnapshotStore } from "../../src/snapshotStore.js";

let h: PgliteHandle;
beforeEach(async () => {
  h = await makePglite();
});
afterEach(async () => {
  await h.close();
});

describe("PgSnapshotStore", () => {
  it("capture + load round-trips a snapshot by requestId", async () => {
    const s = new PgSnapshotStore(h.client);
    const snap = {
      requestId: "s1",
      operation: "scrape",
      url: "https://x.test",
      body: { markdown: "# A", html: "<p>x</p>", title: "A" },
    };
    await s.capture(snap);
    expect(await s.load("s1")).toEqual(snap);
  });

  it("capture ignores objects without a requestId", async () => {
    const s = new PgSnapshotStore(h.client);
    await s.capture({ foo: "bar" });
    expect(await s.load("s1")).toBeUndefined();
  });

  it("capture upserts — a second capture for the same requestId overwrites", async () => {
    const s = new PgSnapshotStore(h.client);
    await s.capture({ requestId: "s1", v: 1 });
    await s.capture({ requestId: "s1", v: 2 });
    const loaded = (await s.load("s1")) as { requestId: string; v: number };
    expect(loaded.v).toBe(2);
  });

  it("load returns undefined for an unknown requestId", async () => {
    const s = new PgSnapshotStore(h.client);
    expect(await s.load("nope")).toBeUndefined();
  });
});
