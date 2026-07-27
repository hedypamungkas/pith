/**
 * Pith — Node/TypeScript SDK quickstart.
 *
 * Run after building the workspace:
 *   npm install && npm run build
 *   npx tsx examples/quickstart.ts
 *
 * scrape + crawl are key-free. extract/search are gated on env vars — Pith
 * never assumes a billable provider by default.
 */
import {
  createEngine,
  createExtractionBackend,
  createBraveSearchBackend,
} from "@pith/core";

async function main() {
  // 1) Scrape — works with zero config (static → headless escalation).
  const pith = createEngine();
  const page = await pith.scrape("https://example.com");
  console.log("[scrape] title:", page.title);
  console.log("[scrape] markdown (first 200 chars):", page.markdown.slice(0, 200));

  // 2) Crawl — same-domain bounded, dedup, resumable.
  const handle = await pith.crawl("https://example.com", {
    maxDepth: 1,
    maxPages: 5,
  });
  const status = await handle.wait();
  console.log("[crawl] status:", status.status, "pages:", status.pagesSucceeded);

  // 3) Structured extract — needs an OpenAI-compatible backend.
  if (process.env.EXTRACTION_API_KEY) {
    const withExtract = createEngine({
      extractionBackend: createExtractionBackend({
        baseUrl: process.env.EXTRACTION_BASE_URL ?? "https://api.openai.com/v1",
        apiKey: process.env.EXTRACTION_API_KEY,
        model: process.env.EXTRACTION_MODEL ?? "gpt-4o-mini",
      }),
    });
    const result = await withExtract.extract("https://example.com", {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
    });
    console.log("[extract] data:", result.data, "confidence:", result.confidence);
    console.log("[extract] flagged low-confidence fields:", result.flaggedFields);
  } else {
    console.log("[extract] skipped — set EXTRACTION_API_KEY to enable");
  }

  // 4) Search — needs a search backend.
  if (process.env.BRAVE_API_KEY) {
    const withSearch = createEngine({
      searchBackend: createBraveSearchBackend(process.env.BRAVE_API_KEY),
    });
    const results = await withSearch.search("typescript web scraping");
    console.log("[search] results:", results.results.length);
  } else {
    console.log("[search] skipped — set BRAVE_API_KEY to enable");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
