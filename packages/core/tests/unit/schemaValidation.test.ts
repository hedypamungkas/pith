import { describe, it, expect } from "vitest";
import { compileExtractionSchema } from "../../src/extract/schemaValidation.js";
import { InvalidExtractionSchemaError } from "../../src/extract/extractionPort.js";

describe("compileExtractionSchema", () => {
  it("compiles a valid object schema and returns a validator", () => {
    const validate = compileExtractionSchema({
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
    });
    expect(validate({ a: "x" })).toBe(true);
    expect(validate({})).toBe(false);
  });

  it("resolves recursive $ref via $defs", () => {
    const validate = compileExtractionSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        children: { type: "array", items: { $ref: "#/$defs/node" } },
      },
      required: ["name"],
      $defs: {
        node: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    });
    expect(validate({ name: "root", children: [{ name: "c1" }] })).toBe(true);
    expect(validate({ name: "root", children: [{}] })).toBe(false);
  });

  it("tolerates unknown keywords under strict:false", () => {
    expect(() =>
      compileExtractionSchema({ type: "string", madeUpKeyword: true }),
    ).not.toThrow();
  });

  it("throws InvalidExtractionSchemaError on a malformed schema", () => {
    expect(() => compileExtractionSchema({ type: "not-a-real-type" })).toThrow(
      InvalidExtractionSchemaError,
    );
  });
});
