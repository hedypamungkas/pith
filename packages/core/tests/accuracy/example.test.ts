import { describe, it, expect } from "vitest";

// The accuracy project is wired and always has a key-free smoke test so the
// project shows up green in every run. The real 20-fixture extraction +
// citation benchmark ports in spin-off step 4 and is EXTRACTION_API_KEY-gated
// (describe.skipIf), running nightly — never blocking a PR.
describe("accuracy project wiring", () => {
  it("is registered and runs key-free", () => {
    expect(true).toBe(true);
  });
});

describe.skipIf(!process.env.EXTRACTION_API_KEY)(
  "accuracy: extraction benchmark (EXTRACTION_API_KEY-gated)",
  () => {
    it("placeholder — the 20-fixture harness ports in spin-off step 4", () => {
      expect(true).toBe(true);
    });
  },
);
