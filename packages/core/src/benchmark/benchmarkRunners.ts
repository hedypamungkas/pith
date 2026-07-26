import type { BenchmarkRunner } from "./benchmarkRunner.js";

/**
 * The registry of benchmark runners that ship with the core. Starts EMPTY: the
 * sole runner in the source project (extractionCitationBenchmarkRunner) is a
 * self-HTTP adapter that depends on the host's running API + a seeded API key,
 * so it is an OPTIONAL adapter, not core. Hosts register their own runners.
 */
export const BENCHMARK_RUNNERS: BenchmarkRunner[] = [];
