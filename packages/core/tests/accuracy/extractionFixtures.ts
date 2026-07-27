/**
 * 20 labeled fixtures for the extraction accuracy + citation-verification
 * benchmark (tests/accuracy/extraction.accuracy.test.ts). Ported from the
 * source project's tests/fixtures/extractionFixtures.ts.
 *
 * Clean-room for OSS: every fixture is synthetic — no real domains (only the
 * RFC-2606 reserved `*.test`), no real phone numbers (only the NANP-reserved
 * fictional `555` prefix), no real people, and no real-world works/repos
 * (the source's book/film/paper/repo fixtures were swapped for fictional
 * equivalents of the same shape — see git history of this file). Each fixture
 * exercises the same field *types* the extractor must handle (string / number /
 * boolean), so the benchmark's signal is preserved.
 */
export interface ExtractionFixture {
  name: string;
  markdown: string;
  /** Plain-text equivalent of `markdown` (what Readability's `text` output
   * would look like) — citations must quote verbatim from this, not from
   * `markdown`, so the accuracy test can verify them the same way
   * citationVerifier.ts does in production. Derived below, not hand-typed
   * per fixture: none of these fixtures use any Markdown syntax beyond
   * `#`/`##` headings, so stripping those is a faithful equivalent. */
  text: string;
  schema: Record<string, unknown>;
  /** Ground truth for each top-level schema field. */
  expected: Record<string, unknown>;
}

type RawExtractionFixture = Omit<ExtractionFixture, "text">;

function toPlainText(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, ""))
    .join("\n");
}

const RAW_EXTRACTION_FIXTURES: RawExtractionFixture[] = [
  {
    name: "product-listing",
    markdown:
      "# Adjustable Desk Lamp\n\nPrice: $34.99\n\nThis lamp has 3 brightness levels and a USB-C charging port. In stock, ships in 2 business days.",
    schema: {
      type: "object",
      properties: {
        productName: { type: "string" },
        priceUsd: { type: "number" },
        inStock: { type: "boolean" },
      },
      required: ["productName", "priceUsd", "inStock"],
    },
    expected: { productName: "Adjustable Desk Lamp", priceUsd: 34.99, inStock: true },
  },
  {
    name: "article-metadata",
    markdown:
      "# City Council Approves New Transit Line\n\nBy Jamie Rivera | Published March 3, 2026\n\nThe city council voted 7-2 to approve the new light rail project.",
    schema: {
      type: "object",
      properties: {
        headline: { type: "string" },
        author: { type: "string" },
      },
      required: ["headline", "author"],
    },
    expected: {
      headline: "City Council Approves New Transit Line",
      author: "Jamie Rivera",
    },
  },
  {
    name: "contact-info",
    markdown:
      "## Contact Us\n\nEmail: support@example.test\nPhone: (555) 123-4567\nOffice hours: Monday to Friday, 9am-5pm.",
    schema: {
      type: "object",
      properties: {
        email: { type: "string" },
        phone: { type: "string" },
      },
      required: ["email", "phone"],
    },
    expected: { email: "support@example.test", phone: "(555) 123-4567" },
  },
  {
    name: "event-details",
    markdown:
      "# Annual Backend Engineering Summit\n\nDate: June 12, 2026\nLocation: Austin, TX\nTicket price: $199",
    schema: {
      type: "object",
      properties: {
        eventName: { type: "string" },
        location: { type: "string" },
        priceUsd: { type: "number" },
      },
      required: ["eventName", "location", "priceUsd"],
    },
    expected: {
      eventName: "Annual Backend Engineering Summit",
      location: "Austin, TX",
      priceUsd: 199,
    },
  },
  {
    name: "job-posting",
    markdown:
      "## Senior Backend Engineer\n\nLocation: Remote\nSalary range: $140,000 - $180,000\nRequires 5+ years of experience with distributed systems.",
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        remote: { type: "boolean" },
      },
      required: ["title", "remote"],
    },
    expected: { title: "Senior Backend Engineer", remote: true },
  },
  {
    name: "recipe",
    markdown:
      "# Simple Lentil Soup\n\nPrep time: 10 minutes\nCook time: 25 minutes\nServes: 4\n\nIngredients: red lentils, onion, carrot, celery, vegetable stock, bay leaf.",
    schema: {
      type: "object",
      properties: {
        cookTimeMinutes: { type: "number" },
        servings: { type: "number" },
      },
      required: ["cookTimeMinutes", "servings"],
    },
    expected: { cookTimeMinutes: 25, servings: 4 },
  },
  {
    name: "pricing-plan",
    markdown:
      "## Growth Plan\n\n$99/month\n\nIncludes 50,000 requests per month and email support with a 12 hour response time.",
    schema: {
      type: "object",
      properties: {
        planName: { type: "string" },
        monthlyPriceUsd: { type: "number" },
        requestsIncluded: { type: "number" },
      },
      required: ["planName", "monthlyPriceUsd", "requestsIncluded"],
    },
    expected: { planName: "Growth Plan", monthlyPriceUsd: 99, requestsIncluded: 50000 },
  },
  {
    name: "business-hours",
    markdown:
      "# Example Cafe\n\nOpen daily from 7:00 AM to 6:00 PM. Closed on public holidays.",
    schema: {
      type: "object",
      properties: {
        openTime: { type: "string" },
        closeTime: { type: "string" },
      },
      required: ["openTime", "closeTime"],
    },
    expected: { openTime: "7:00 AM", closeTime: "6:00 PM" },
  },
  {
    name: "faq-answer",
    markdown:
      "## How is usage calculated?\n\nUsage is metered per successfully completed request. Failed or timed-out requests are never billed.",
    schema: {
      type: "object",
      properties: {
        question: { type: "string" },
        billsFailedRequests: { type: "boolean" },
      },
      required: ["question", "billsFailedRequests"],
    },
    expected: {
      question: "How is usage calculated?",
      billsFailedRequests: false,
    },
  },
  {
    name: "book-info",
    // Scrubbed from the source's real-title/real-author fixture into a
    // fictional book of identical shape (title string + page-count number).
    markdown:
      "# The Prudent Coder\n\nAuthors: Sam Example, Rowan Tester\nPages: 352\nPublished: 1999",
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        pageCount: { type: "number" },
      },
      required: ["title", "pageCount"],
    },
    expected: { title: "The Prudent Coder", pageCount: 352 },
  },
  {
    name: "movie-info",
    // Scrubbed from the source's real-film/real-director fixture into a
    // fictional film of identical shape (director string + runtime number).
    markdown:
      "# The Quiet Horizon (2021)\n\nDirector: Mara Linden\nRuntime: 116 minutes\nRating: 7.9/10",
    schema: {
      type: "object",
      properties: {
        director: { type: "string" },
        runtimeMinutes: { type: "number" },
      },
      required: ["director", "runtimeMinutes"],
    },
    expected: { director: "Mara Linden", runtimeMinutes: 116 },
  },
  {
    name: "menu-item",
    markdown:
      "## Margherita Pizza\n\n$14.00\n\nTomato, mozzarella, fresh basil. Contains gluten and dairy.",
    schema: {
      type: "object",
      properties: {
        itemName: { type: "string" },
        priceUsd: { type: "number" },
        containsGluten: { type: "boolean" },
      },
      required: ["itemName", "priceUsd", "containsGluten"],
    },
    expected: { itemName: "Margherita Pizza", priceUsd: 14.0, containsGluten: true },
  },
  {
    name: "weather-report",
    markdown:
      "## Today's Forecast\n\nHigh: 72F, Low: 54F\nConditions: partly cloudy\nChance of rain: 20%",
    schema: {
      type: "object",
      properties: {
        highF: { type: "number" },
        lowF: { type: "number" },
      },
      required: ["highF", "lowF"],
    },
    expected: { highF: 72, lowF: 54 },
  },
  {
    name: "changelog-entry",
    markdown:
      "## v2.4.0 - 2026-02-10\n\n### Fixed\n- Resolved a race condition in the crawl finalizer.\n\n### Added\n- New /v1/search endpoint.",
    schema: {
      type: "object",
      properties: {
        version: { type: "string" },
        releaseDate: { type: "string" },
      },
      required: ["version", "releaseDate"],
    },
    // "v2.4.0" (not "2.4.0") — the source literally reads "v2.4.0" and the
    // schema doesn't ask for the "v" to be stripped, so a model that quotes
    // it verbatim (confidence 0.99, citation independently verified) is
    // correct, not wrong. This fixture previously expected "2.4.0" without
    // the prefix, which fieldsMatch's exact-string comparison rightly
    // rejected — a labeling bug discovered during confidence-threshold
    // calibration, not a genuine extraction/confidence-signal failure.
    expected: { version: "v2.4.0", releaseDate: "2026-02-10" },
  },
  {
    name: "real-estate-listing",
    markdown:
      "# 123 Maple Street\n\n3 bedrooms, 2 bathrooms\nAsking price: $425,000\nSquare footage: 1,850 sq ft",
    schema: {
      type: "object",
      properties: {
        bedrooms: { type: "number" },
        askingPriceUsd: { type: "number" },
      },
      required: ["bedrooms", "askingPriceUsd"],
    },
    expected: { bedrooms: 3, askingPriceUsd: 425000 },
  },
  {
    name: "paper-abstract",
    // Scrubbed from the source's real-paper fixture into a fictional paper of
    // identical shape (title string + venue string); the single abstract
    // sentence is original phrasing, not a verbatim quote from any real work.
    markdown:
      "# Sparse Routing for Mixture Models\n\nAuthors: Okafor et al.\nVenue: ICML 2023\n\nWe introduce a routing scheme that selects a small subset of expert modules per input, reducing computation while preserving accuracy.",
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        venue: { type: "string" },
      },
      required: ["title", "venue"],
    },
    expected: { title: "Sparse Routing for Mixture Models", venue: "ICML 2023" },
  },
  {
    name: "github-repo-info",
    // Scrubbed from the source's real-repo fixture into a fictional repo of
    // identical shape (stars number + license string). "MIT" is an SPDX
    // identifier, not attribution; "TypeScript" is a language name.
    markdown:
      "# example-toolkit\n\nStars: 69,500\nLicense: MIT\nPrimary language: TypeScript",
    schema: {
      type: "object",
      properties: {
        stars: { type: "number" },
        license: { type: "string" },
      },
      required: ["stars", "license"],
    },
    expected: { stars: 69500, license: "MIT" },
  },
  {
    name: "conference-talk",
    markdown:
      "## Scaling Postgres to 10M Rows\n\nSpeaker: Priya Nair\nTrack: Databases\nDuration: 40 minutes",
    schema: {
      type: "object",
      properties: {
        speaker: { type: "string" },
        durationMinutes: { type: "number" },
      },
      required: ["speaker", "durationMinutes"],
    },
    expected: { speaker: "Priya Nair", durationMinutes: 40 },
  },
  {
    name: "invoice",
    markdown:
      "# Invoice #4471\n\nBill to: Acme Corp\nTotal due: $1,240.00\nDue date: 2026-04-01",
    schema: {
      type: "object",
      properties: {
        invoiceNumber: { type: "string" },
        totalUsd: { type: "number" },
      },
      required: ["invoiceNumber", "totalUsd"],
    },
    expected: { invoiceNumber: "4471", totalUsd: 1240.0 },
  },
  {
    name: "review-card",
    markdown:
      "## Review by Alex\n\nRating: 4 out of 5 stars\n\n\"Great build quality, but the battery life is shorter than advertised.\"",
    schema: {
      type: "object",
      properties: {
        reviewer: { type: "string" },
        ratingOutOf5: { type: "number" },
      },
      required: ["reviewer", "ratingOutOf5"],
    },
    expected: { reviewer: "Alex", ratingOutOf5: 4 },
  },
];

export const EXTRACTION_FIXTURES: ExtractionFixture[] = RAW_EXTRACTION_FIXTURES.map((f) => ({
  ...f,
  text: toPlainText(f.markdown),
}));
