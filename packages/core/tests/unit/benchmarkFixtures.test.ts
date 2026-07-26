import { describe, it, expect } from "vitest";
import { BENCHMARK_FIXTURES } from "../../src/benchmark/benchmarkFixtures.js";

describe("BENCHMARK_FIXTURES", () => {
  it("has 5 well-formed fixtures", () => {
    expect(BENCHMARK_FIXTURES).toHaveLength(5);
    for (const f of BENCHMARK_FIXTURES) {
      expect(typeof f.name).toBe("string");
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.html.length).toBeGreaterThan(0);
      expect(f.schema).toBeInstanceOf(Object);
      expect(f.expectedData).toBeInstanceOf(Object);
    }
  });

  it("fixture names are unique", () => {
    const names = BENCHMARK_FIXTURES.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
