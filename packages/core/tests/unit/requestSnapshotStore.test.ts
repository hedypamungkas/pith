import { describe, it, expect } from "vitest";
import { objectKeyForRequestSnapshot } from "../../src/inspection/requestSnapshotStore.js";

describe("objectKeyForRequestSnapshot", () => {
  it("builds the canonical request-snapshots/<id>.json key", () => {
    expect(objectKeyForRequestSnapshot("r1")).toBe("request-snapshots/r1.json");
    expect(objectKeyForRequestSnapshot("abc-123_def")).toBe(
      "request-snapshots/abc-123_def.json",
    );
  });
});
