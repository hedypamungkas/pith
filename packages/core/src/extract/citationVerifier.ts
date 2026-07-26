import type { ModelCitation } from "./extractionPort.js";

export interface VerifiedCitation {
  /** The model's claimed quote, unchanged. */
  quote: string;
  /** Zeroed whenever `verified` is false — an unconfirmed quote can't be
   * trusted to support anything, regardless of what the model claimed. */
  supportScore: number;
  /** True iff `quote`, whitespace/case-normalized, is a literal substring of
   * the fetched page's plain text. Deterministic substring matching only, by
   * design — this is a guardrail against a hallucinated quote, not a relevance
   * judge (that's what supportScore is for). */
  verified: boolean;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** An empty quote never verifies — `"".includes("")` would otherwise let a
 * field with no real citation pass trivially. */
export function isQuoteSupportedByText(quote: string, sourceText: string): boolean {
  const normalizedQuote = normalize(quote);
  return normalizedQuote.length > 0 && normalize(sourceText).includes(normalizedQuote);
}

/**
 * Verifies every field's claimed citation against `sourceText` (the page's
 * plain Readability text — see htmlToMarkdown.ts's `text` field, never the
 * Markdown, whose invented syntax isn't a literal substring of the original
 * page). A pure function with no DB/queue/adapter dependency, so it's
 * independently reusable.
 */
export function verifyCitations(
  citations: Record<string, ModelCitation>,
  sourceText: string,
): Record<string, VerifiedCitation> {
  return Object.fromEntries(
    Object.entries(citations).map(([field, citation]) => {
      const verified = isQuoteSupportedByText(citation.quote, sourceText);
      return [
        field,
        {
          quote: citation.quote,
          supportScore: verified ? citation.supportScore : 0,
          verified,
        },
      ];
    }),
  );
}
