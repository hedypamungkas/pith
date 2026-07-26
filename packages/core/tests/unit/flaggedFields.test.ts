import { describe, it, expect } from "vitest";
import { computeFlaggedFields } from "../../src/extract/flaggedFields.js";
import type { VerifiedCitation } from "../../src/extract/citationVerifier.js";

const strong = (quote = "q"): VerifiedCitation => ({
  quote,
  supportScore: 0.9,
  verified: true,
});
const none = (): VerifiedCitation => ({ quote: "", supportScore: 0, verified: false });

describe("computeFlaggedFields", () => {
  it("flags nothing when every field is confident + well-cited", () => {
    expect(
      computeFlaggedFields(
        { a: 1, b: 2 },
        { a: 0.9, b: 0.95 },
        { a: strong(), b: strong() },
      ),
    ).toEqual([]);
  });

  it("flags a low-confidence field (confidence < 0.7)", () => {
    expect(computeFlaggedFields({ a: 1 }, { a: 0.4 }, { a: strong() })).toEqual(["a"]);
  });

  it("flags an unverified-citation field", () => {
    expect(computeFlaggedFields({ a: 1 }, { a: 0.9 }, { a: none() })).toEqual(["a"]);
  });

  it("flags a verified field whose citation supportScore < 0.7", () => {
    expect(
      computeFlaggedFields(
        { a: 1 },
        { a: 0.9 },
        { a: { quote: "q", supportScore: 0.5, verified: true } },
      ),
    ).toEqual(["a"]);
  });

  it("does NOT flag at the 0.7 boundary (confidence 0.7, support 0.7, verified)", () => {
    expect(
      computeFlaggedFields(
        { a: 1 },
        { a: 0.7 },
        { a: { quote: "q", supportScore: 0.7, verified: true } },
      ),
    ).toEqual([]);
  });

  it("flags a field missing from confidence (defaults to 0)", () => {
    expect(
      computeFlaggedFields(
        { a: 1, b: 2 },
        { b: 0.9 },
        { a: strong(), b: strong() },
      ),
    ).toEqual(["a"]);
  });

  it("flags a field missing from citations (treated as weak)", () => {
    expect(computeFlaggedFields({ a: 1 }, { a: 0.9 }, {})).toEqual(["a"]);
  });

  it("does not return fields absent from data", () => {
    expect(
      computeFlaggedFields({ a: 1 }, { a: 0.9, z: 0.1 }, { a: strong() }),
    ).toEqual([]);
  });
});
