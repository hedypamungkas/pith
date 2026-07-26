/** A citation as the model claims it — not yet checked against the fetched
 * page. See citationVerifier.ts for turning this into a VerifiedCitation. */
export interface ModelCitation {
  /** The model's claimed verbatim quote (empty string if it found no
   * supporting text for this field). */
  quote: string;
  /** Model's self-reported 0-1: how well this quote backs the value. Not
   * trustworthy on its own — see citationVerifier.ts, which zeroes this
   * whenever `quote` isn't independently confirmed to appear on the page. */
  supportScore: number;
}

export interface ExtractionResult {
  /** Matches the caller's schema exactly — kept clean of confidence noise. */
  data: Record<string, unknown>;
  /** Top-level field name -> confidence score in [0, 1], self-reported by
   * the model. Nested fields aren't scored individually in this MVP. */
  confidence: Record<string, number>;
  /** Top-level field name -> the model's claimed citation. Nested fields
   * aren't cited individually, matching `confidence`'s same limitation.
   * Unverified — the caller is responsible for calling citationVerifier.ts
   * against the actual fetched page text before trusting these. */
  citations: Record<string, ModelCitation>;
  model: string;
}

export class InvalidExtractionSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidExtractionSchemaError";
  }
}

/**
 * Fields scored below this (or whose citation isn't verified / has a support
 * score below this) are flagged as low-confidence rather than returned as if
 * the model were certain.
 *
 * Canonical home: the extraction port. flaggedFields, the adapter, and replay
 * all import it from here, so the flagger is not coupled to a specific backend
 * implementation. (In the source project this lived on the adapter; it moved
 * here during the OSS carve-out.)
 *
 * Value (0.7) retained from calibration against a labeled fixture set —
 * revisit with a larger, real-traffic-derived labeled set once available.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

/** Port for an LLM-based structured-extraction backend, mirroring
 * SearchBackend's swappable-adapter pattern. */
export interface ExtractionBackend {
  /**
   * @param markdown Cleaned page content (not raw HTML) to extract from.
   * @param text Plain visible-page text (Readability's output, not Markdown
   *   syntax) — citations must quote verbatim from this, since it's the only
   *   representation whose spans are real substrings of the live page an
   *   independent caller could re-fetch and verify.
   * @param schema Caller-provided JSON Schema describing the desired output shape.
   * @throws InvalidExtractionSchemaError if `schema` itself isn't a valid JSON Schema.
   */
  extract(
    markdown: string,
    text: string,
    schema: Record<string, unknown>,
  ): Promise<ExtractionResult>;
}
