/** Loose equality for comparing an extracted field's value against ground
 * truth — case/whitespace-insensitive for strings, epsilon-tolerant for
 * numbers. Shared by the accuracy benchmark and any caller that scores
 * extracted values against expected values identically. */
export function fieldsMatch(actual: unknown, expected: unknown): boolean {
  if (typeof expected === "string" && typeof actual === "string") {
    return actual.trim().toLowerCase() === expected.trim().toLowerCase();
  }
  if (typeof expected === "number" && typeof actual === "number") {
    return Math.abs(actual - expected) < 0.01;
  }
  return actual === expected;
}
