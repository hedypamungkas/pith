import { describe, it, expect } from "vitest";
import { FRESHNESS_VALUES } from "../../src/search/searchPort.js";
import { FRESHNESS_TO_BRAVE } from "../../src/search/braveSearchAdapter.js";

describe("searchPort freshness invariant", () => {
  it("FRESHNESS_VALUES is the canonical list", () => {
    expect([...FRESHNESS_VALUES]).toEqual(["day", "week", "month", "year"]);
  });

  it("the brave adapter maps every freshness value (no drift)", () => {
    expect(Object.keys(FRESHNESS_TO_BRAVE).sort()).toEqual(
      [...FRESHNESS_VALUES].sort(),
    );
    for (const f of FRESHNESS_VALUES) {
      expect(typeof FRESHNESS_TO_BRAVE[f]).toBe("string");
      expect(FRESHNESS_TO_BRAVE[f].length).toBeGreaterThan(0);
    }
  });
});
