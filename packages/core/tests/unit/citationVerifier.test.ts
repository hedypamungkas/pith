import { describe, expect, it } from "vitest";
import { isQuoteSupportedByText, verifyCitations } from "../../src/extract/citationVerifier.js";

describe("isQuoteSupportedByText", () => {
  it("verifies a quote that appears verbatim in the source text", () => {
    expect(
      isQuoteSupportedByText("Adjustable Desk Lamp", "Adjustable Desk Lamp\nPrice: $34.99"),
    ).toBe(true);
  });

  it("is whitespace-normalized (line-wrapping/extra spaces don't break a match)", () => {
    expect(
      isQuoteSupportedByText(
        "Adjustable   Desk\nLamp",
        "Some intro text. Adjustable Desk Lamp. More text.",
      ),
    ).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isQuoteSupportedByText("ADJUSTABLE DESK LAMP", "adjustable desk lamp")).toBe(true);
  });

  it("rejects a quote that does not appear in the source text (hallucinated)", () => {
    expect(isQuoteSupportedByText("This never appeared", "Adjustable Desk Lamp")).toBe(false);
  });

  it("rejects an empty quote even against empty source text", () => {
    expect(isQuoteSupportedByText("", "")).toBe(false);
    expect(isQuoteSupportedByText("", "Adjustable Desk Lamp")).toBe(false);
  });

  it("rejects a quote that is whitespace-only", () => {
    expect(isQuoteSupportedByText("   \n\t  ", "Adjustable Desk Lamp")).toBe(false);
  });
});

describe("verifyCitations", () => {
  it("preserves supportScore and marks verified:true for a quote found in the text", () => {
    const result = verifyCitations(
      { productName: { quote: "Adjustable Desk Lamp", supportScore: 0.9 } },
      "Adjustable Desk Lamp\nPrice: $34.99",
    );
    expect(result.productName).toEqual({
      quote: "Adjustable Desk Lamp",
      supportScore: 0.9,
      verified: true,
    });
  });

  it("zeroes supportScore regardless of the model's claim when the quote isn't verified", () => {
    const result = verifyCitations(
      { productName: { quote: "a hallucinated quote", supportScore: 0.95 } },
      "Adjustable Desk Lamp\nPrice: $34.99",
    );
    expect(result.productName).toEqual({
      quote: "a hallucinated quote",
      supportScore: 0,
      verified: false,
    });
  });

  it("handles multiple fields independently", () => {
    const result = verifyCitations(
      {
        productName: { quote: "Adjustable Desk Lamp", supportScore: 0.9 },
        priceUsd: { quote: "made up price text", supportScore: 0.8 },
      },
      "Adjustable Desk Lamp\nPrice: $34.99",
    );
    expect(result.productName!.verified).toBe(true);
    expect(result.priceUsd!.verified).toBe(false);
    expect(result.priceUsd!.supportScore).toBe(0);
  });
});
