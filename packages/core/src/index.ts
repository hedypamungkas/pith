/**
 * Pith — the essential web, for agents.
 *
 * Importing this module and calling `createEngine()` must pull in ZERO host
 * infrastructure — enforced by the `smoke` project and the
 * `import/no-restricted-paths` lint rule. Playwright (the headless tier) is
 * imported lazily by `launchBrowser`, so a static-only consumer pays nothing
 * for it. The optional MCP/HTTP faces and the extraction/search backends are
 * dynamic-imported so an SDK-only consumer installs nothing extra.
 */

// --- engine spine ---
export { createEngine } from "./engine.js";
export type { Engine, EngineOptions, ExtractOptions, CrawlOptions } from "./engine.js";
export { NotImplementedError, NotConfiguredError } from "./errors.js";
export { createNullPorts } from "./ports/nullPorts.js";
export type {
  CorePorts,
  CallerContext,
  CostRecorder,
  SnapshotStore,
  CrawlStateStore,
  ContentStore,
  JobQueue,
  RobotsResolver,
  FreshnessCache,
  FreshnessRecord,
  RecordFreshnessInput,
  DueUrl,
  Clock,
} from "./ports/corePorts.js";
export { InMemoryFreshnessCache } from "./ports/nullPorts.js";

// --- types + pricing + budget ---
export type { StorageState } from "./types.js";
export {
  centsForTier,
  DEFAULT_TIER_PRICE_CENTS,
  type Tier,
  type TierPriceTable,
  type CentsForTier,
  type ScrapeAttempt,
} from "./pricing.js";
export {
  fetchBudgetFrom,
  canAffordTier,
  describeFetchBudgetOutcome,
  type FetchBudget,
  type FetchBudgetOutcome,
} from "./fetchBudget.js";

// --- content + crawl + lib ---
export { htmlToMarkdown, type ExtractedContent } from "./content/htmlToMarkdown.js";
export { extractLinks, type LinkExtractionOptions } from "./crawl/linkExtractor.js";
export { Semaphore } from "./lib/semaphore.js";

// --- scrape core ---
export {
  scrapeUrlCore,
  ScrapeAllTiersFailedError,
  type ScrapeUrlResult,
  type ScrapeUrlOptions,
} from "./scrape/scrapeUrlCore.js";

// --- freshness (opt-in stale-while-revalidate cache) ---
export {
  DEFAULT_TIER_CATALOG,
  resolveTier,
  UnknownFreshnessTierError,
  type FreshnessTierDef,
  type FreshnessTierCatalog,
} from "./freshness/freshnessTiers.js";
export { computeFreshness, type FreshnessInfo } from "./freshness/computeFreshness.js";
export {
  composeFreshness,
  type FreshnessScrapeResult,
  type ComposeFreshnessDeps,
} from "./freshness/composeFreshness.js";

// --- crawl ---
export { pureCrawler, type CrawlHandle, type CrawlKickoffOptions } from "./crawl/pureCrawler.js";
export {
  objectKeyForCrawlPage,
  parseCrawlPageObjectKey,
} from "./crawl/crawlPageContentStore.js";
export type {
  CrawlBounds,
  CrawlStatus,
  CrawlPageJobData,
  CrawlPageDetail,
  DiscoveredPage,
  PageCounts,
  PageStatus,
  ResumablePausedPage,
} from "./crawl/types.js";

// --- fetch tier ---
export {
  assertPublicHost,
  assertAllowedScheme,
  BlockedHostError,
} from "./fetch/ssrfGuard.js";
export {
  fetchStatic,
  StaticFetchError,
  type StaticFetchResult,
} from "./fetch/staticFetcher.js";
export {
  launchBrowser,
  closeBrowser,
  fetchHeadless,
  type HeadlessFetchResult,
} from "./fetch/headlessFetcher.js";
export { USER_AGENT, ROBOTS_USER_AGENT_TOKEN } from "./fetch/userAgent.js";
export {
  createRobotsResolver,
  RobotsDisallowedError,
  type RobotsResolverOptions,
} from "./fetch/robotsGuard.js";

// --- extract layer ---
export {
  type ExtractionBackend,
  type ExtractionResult,
  type ModelCitation,
  InvalidExtractionSchemaError,
  LOW_CONFIDENCE_THRESHOLD,
} from "./extract/extractionPort.js";
export { compileExtractionSchema, ajv } from "./extract/schemaValidation.js";
export {
  isQuoteSupportedByText,
  verifyCitations,
  type VerifiedCitation,
} from "./extract/citationVerifier.js";
export { fieldsMatch } from "./extract/fieldMatch.js";
export { computeFlaggedFields } from "./extract/flaggedFields.js";
export { OpenAiCompatibleExtractionAdapter } from "./extract/openAiCompatibleExtractionAdapter.js";
export {
  createExtractionBackend,
  type ExtractionBackendOptions,
} from "./extract/extractionBackend.js";
export { extractPure, type ExtractResult } from "./extract/extractPure.js";

// --- search layer ---
export {
  type SearchBackend,
  type SearchResponse,
  type SearchResultItem,
  type SearchOptions,
  type Freshness,
  FRESHNESS_VALUES,
} from "./search/searchPort.js";
export {
  BraveSearchAdapter,
  BraveSearchError,
  FRESHNESS_TO_BRAVE,
} from "./search/braveSearchAdapter.js";
export { createBraveSearchBackend } from "./search/searchBackend.js";

// --- crypto layer ---
export { type SessionCipher, type EncryptedSessionBlob } from "./auth/sessionCipherPort.js";
export { type KmsKeyProvider } from "./auth/kmsKeyProviderPort.js";
export { EnvKeySessionCipher } from "./auth/envKeySessionCipher.js";
export { LocalKeyProvider } from "./auth/localKeyProvider.js";
export { VaultTransitKeyProvider } from "./auth/vaultTransitKeyProvider.js";

// --- inspection ---
export { replayRequest, type ReplayResult, type ReplayDeps, type ReplayedScrape } from "./inspection/replay.js";
export { type RequestSnapshotBody, objectKeyForRequestSnapshot } from "./inspection/requestSnapshotStore.js";
export { type SnapshotOperation, type RequestSnapshot } from "./inspection/snapshotTypes.js";

// --- benchmark ---
export { type BenchmarkRunner, type BenchmarkCheckResult } from "./benchmark/benchmarkRunner.js";
export { type BenchmarkFixture, BENCHMARK_FIXTURES } from "./benchmark/benchmarkFixtures.js";
export { BENCHMARK_RUNNERS } from "./benchmark/benchmarkRunners.js";
