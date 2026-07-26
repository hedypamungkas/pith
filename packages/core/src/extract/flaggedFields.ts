import type { VerifiedCitation } from "./citationVerifier.js";
import { LOW_CONFIDENCE_THRESHOLD } from "./extractionPort.js";

/**
 * The set of fields flagged for review on an extraction result. A field is
 * flagged when EITHER signal fails — low value-confidence OR its citation
 * isn't independently verified / strongly supporting. The two signals answer
 * different questions, so either one failing is reason enough to flag the
 * field, not silently pick one.
 *
 * Centralized here so the worker, replay, and any future caller apply ONE
 * definition.
 */
export function computeFlaggedFields(
  data: Record<string, unknown>,
  confidence: Record<string, number>,
  citations: Record<string, VerifiedCitation>,
): string[] {
  return Object.keys(data).filter((field) => {
    const lowConfidence = (confidence[field] ?? 0) < LOW_CONFIDENCE_THRESHOLD;
    const citation = citations[field];
    const weakCitation =
      !citation?.verified || citation.supportScore < LOW_CONFIDENCE_THRESHOLD;
    return lowConfidence || weakCitation;
  });
}
