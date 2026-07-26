import { describe, it, expect } from "vitest";
import { fieldsMatch } from "../../src/extract/fieldMatch.js";

describe("fieldsMatch", () => {
  it("strings: case-insensitive + leading/trailing trim (internal whitespace NOT collapsed)", () => {
    expect(fieldsMatch(" Hello ", "hello")).toBe(true);
    expect(fieldsMatch("Hello", "HELLO")).toBe(true);
    expect(fieldsMatch("a  b", "a b")).toBe(false); // internal whitespace differs
  });

  it("numbers: epsilon strict < 0.01", () => {
    expect(fieldsMatch(1.009, 1)).toBe(true);
    expect(fieldsMatch(1.01, 1)).toBe(false); // exactly 0.01 -> false
    expect(fieldsMatch(5, 5)).toBe(true);
  });

  it("NaN never matches", () => {
    expect(fieldsMatch(NaN, NaN)).toBe(false);
    expect(fieldsMatch(NaN, 1)).toBe(false);
  });

  it("mixed types fall through to strict === (5 !== '5')", () => {
    expect(fieldsMatch(5, "5")).toBe(false);
    expect(fieldsMatch("5", 5)).toBe(false);
    expect(fieldsMatch(true, 1)).toBe(false);
  });

  it("null / undefined / booleans: strict equality", () => {
    expect(fieldsMatch(null, null)).toBe(true);
    expect(fieldsMatch(undefined, undefined)).toBe(true);
    expect(fieldsMatch(true, true)).toBe(true);
    expect(fieldsMatch(null, undefined)).toBe(false);
  });
});
