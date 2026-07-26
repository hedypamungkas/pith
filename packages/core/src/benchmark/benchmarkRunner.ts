export interface BenchmarkCheckResult {
  fixtureName: string;
  checkName: string;
  passed: boolean;
  detail?: Record<string, unknown>;
}

/**
 * One capability's benchmark. Implementations own everything about how to
 * produce checks (what to call, what "pass" means); the persistence/aggregation
 * layer owns nothing capability-specific — a future benchmark (e.g. search
 * relevance) is a new file implementing this interface plus one registry entry.
 */
export interface BenchmarkRunner {
  /** e.g. "extraction_citations". */
  readonly capability: string;
  run(): Promise<BenchmarkCheckResult[]>;
}
