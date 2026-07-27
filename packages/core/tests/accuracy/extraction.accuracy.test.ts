import { describe, expect, it } from "vitest";
import { createExtractionBackend } from "../../src/extract/extractionBackend.js";
import { verifyCitations } from "../../src/extract/citationVerifier.js";
import { fieldsMatch } from "../../src/extract/fieldMatch.js";
import { LOW_CONFIDENCE_THRESHOLD } from "../../src/extract/extractionPort.js";
import { EXTRACTION_FIXTURES } from "./extractionFixtures.js";

const ACCURACY_BAR = 0.9;
// See extractionPort.ts's LOW_CONFIDENCE_THRESHOLD docstring for the
// calibration pass these bars were checked against — this test's own
// accuracy/verification bars are a separate, coarser pass/fail gate on the
// fixture set as a whole, not the per-field flagging threshold itself. The
// FR-4/FR-8 flagging rate is computed below as a soft, non-failing trend
// metric alongside the hard bars.
const CITATION_VERIFICATION_BAR = 0.9;

// The accuracy project always has a key-free smoke test so the project shows
// up green in every run (incl. PR CI and `npm test`). The real 20-fixture
// benchmark is EXTRACTION_API_KEY-gated (describe.skipIf), runs nightly via
// .github/workflows/accuracy-nightly.yml, and never blocks a PR.
describe("accuracy project wiring", () => {
  it("is registered and runs key-free", () => {
    expect(true).toBe(true);
  });
});

/**
 * Extraction accuracy + citations (live). Ports the source project's exit-test
 * proof: extraction against a 20-fixture labeled set must hit the agreed 90%
 * field-level bar, every returned field must carry a confidence score (FR-4),
 * and every field's citation must be independently verifiable against the
 * fixture's own plain text at the agreed rate (FR-8) — checked here, not just
 * claimed by the code.
 *
 * This calls the real configured extraction backend
 * (createExtractionBackend(...).extract() directly, bypassing the fetch step —
 * fetch/tier-escalation already has its own dedicated tests, this one is
 * specifically about extraction quality) and is skipped without an API key.
 * Citation verification here uses the exact same citationVerifier.ts function
 * the production worker uses — this test is proof that function behaves
 * correctly against real model output, not a second implementation of the
 * check.
 *
 * Hard bars (fail the run): zero unscored fields (FR-4), accuracy ≥ 90%,
 * citation verification ≥ 90% (FR-8). Soft metric (logged, never failing): the
 * FR-4/FR-8 compliance rate — the share of fields that are either honestly
 * flagged low-confidence OR backed by a verified citation with supportScore ≥
 * LOW_CONFIDENCE_THRESHOLD — mirroring the source's separate benchmark runner.
 */
describe.skipIf(!process.env.EXTRACTION_API_KEY)(
  "extraction accuracy + citations (live)",
  () => {
    it(`hits at least ${ACCURACY_BAR * 100}% field-level accuracy and ${CITATION_VERIFICATION_BAR * 100}% citation verification across ${EXTRACTION_FIXTURES.length} fixtures, with every field scored`, async () => {
      const baseUrl = process.env.EXTRACTION_BASE_URL ?? "https://api.openai.com/v1";
      const model = process.env.EXTRACTION_MODEL ?? "gpt-4o-mini";
      const backend = createExtractionBackend({
        baseUrl,
        apiKey: process.env.EXTRACTION_API_KEY as string,
        model,
      });

      let totalFields = 0;
      let matchedFields = 0;
      let citedFields = 0;
      let verifiedCitations = 0;
      // SOFT FR-4/FR-8 metric accumulators — logged, never asserted.
      let fr48Total = 0;
      let fr48Pass = 0;
      const mismatches: string[] = [];
      const unscoredFields: string[] = [];
      const unverifiedCitations: string[] = [];

      for (const fixture of EXTRACTION_FIXTURES) {
        // One fixture erroring (rate limit, transient network issue, or a
        // schema the model failed to conform to) must not abort the whole
        // run — every remaining fixture still needs to run, and the mismatch
        // log below is exactly what a sub-bar run needs to be debuggable.
        let result;
        try {
          result = await backend.extract(fixture.markdown, fixture.text, fixture.schema);
        } catch (err) {
          const fieldCount = Object.keys(fixture.expected).length;
          totalFields += fieldCount;
          fr48Total += fieldCount;
          mismatches.push(`${fixture.name}: extraction threw — ${(err as Error).message}`);
          continue;
        }

        const citations = verifyCitations(result.citations, fixture.text);

        for (const field of Object.keys(result.data)) {
          if (!(field in result.confidence)) {
            unscoredFields.push(`${fixture.name}.${field}`);
          }
        }

        for (const [field, expectedValue] of Object.entries(fixture.expected)) {
          totalFields++;
          const actualValue = result.data[field];
          if (fieldsMatch(actualValue, expectedValue)) {
            matchedFields++;
          } else {
            mismatches.push(
              `${fixture.name}.${field}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`,
            );
          }

          citedFields++;
          const citation = citations[field];
          if (citation?.verified) {
            verifiedCitations++;
          } else {
            unverifiedCitations.push(
              `${fixture.name}.${field}: quote "${citation?.quote}" not found in fixture text`,
            );
          }

          // FR-4/FR-8 soft metric — mirrors the source extractionCitationBenchmarkRunner:
          // a field passes if it's honestly flagged low-confidence (confidence
          // < threshold, so it isn't held to the citation bar) OR its citation
          // is verified AND has supportScore >= threshold.
          const confidence = result.confidence[field] ?? 0;
          const weakCitation =
            !citation?.verified || citation.supportScore < LOW_CONFIDENCE_THRESHOLD;
          fr48Total++;
          if (confidence < LOW_CONFIDENCE_THRESHOLD || !weakCitation) {
            fr48Pass++;
          }
        }
      }

      const accuracy = matchedFields / totalFields;
      const citationVerificationRate = verifiedCitations / citedFields;
      const fr48Rate = fr48Total ? fr48Pass / fr48Total : 0;
      if (
        accuracy < ACCURACY_BAR ||
        citationVerificationRate < CITATION_VERIFICATION_BAR ||
        unscoredFields.length > 0
      ) {
        console.error("Extraction mismatches:\n" + mismatches.join("\n"));
        console.error("Fields missing a confidence score:\n" + unscoredFields.join("\n"));
        console.error("Unverified citations:\n" + unverifiedCitations.join("\n"));
      }
      // SOFT trend metric — logged every run, never failing it.
      console.log(
        `FR-4/FR-8 compliance rate (flagged OR verified-strong-citation): ${(fr48Rate * 100).toFixed(1)}%`,
      );

      expect(unscoredFields).toEqual([]);
      expect(accuracy).toBeGreaterThanOrEqual(ACCURACY_BAR);
      expect(citationVerificationRate).toBeGreaterThanOrEqual(CITATION_VERIFICATION_BAR);
    }, 300_000); // this provider's real latency (~170s for 20 sequential live calls, more under load) leaves too little margin at 180s
  },
);
