export interface BenchmarkFixture {
  /** Fixture identifier. */
  name: string;
  html: string;
  schema: Record<string, unknown>;
  /** Ground truth for each top-level schema field. */
  expectedData: Record<string, unknown>;
}

/**
 * A small set of real HTML + schema + expected-data fixtures for the
 * extraction/citations benchmark. Kept small specifically to bound the ongoing
 * LLM cost of a benchmark that runs on a recurring schedule, not just once.
 * Distinct from the accuracy test's larger Markdown-only fixture set.
 */
export const BENCHMARK_FIXTURES: BenchmarkFixture[] = [
  {
    name: "product-listing",
    html: `<!doctype html><html><head><title>Adjustable Desk Lamp</title></head><body>
      <main><article>
        <h1>Adjustable Desk Lamp</h1>
        <p>Price: $34.99</p>
        <p>This lamp has 3 brightness levels and a USB-C charging port. In stock, ships in 2 business days.</p>
      </article></main>
    </body></html>`,
    schema: {
      type: "object",
      properties: {
        productName: { type: "string" },
        priceUsd: { type: "number" },
        inStock: { type: "boolean" },
      },
      required: ["productName", "priceUsd", "inStock"],
    },
    expectedData: { productName: "Adjustable Desk Lamp", priceUsd: 34.99, inStock: true },
  },
  {
    name: "article-metadata",
    html: `<!doctype html><html><head><title>City Council Approves New Transit Line</title></head><body>
      <main><article>
        <h1>City Council Approves New Transit Line</h1>
        <p>By Jamie Rivera | Published March 3, 2026</p>
        <p>The city council voted 7-2 to approve the new light rail project.</p>
      </article></main>
    </body></html>`,
    schema: {
      type: "object",
      properties: {
        headline: { type: "string" },
        author: { type: "string" },
      },
      required: ["headline", "author"],
    },
    expectedData: {
      headline: "City Council Approves New Transit Line",
      author: "Jamie Rivera",
    },
  },
  {
    name: "contact-info",
    html: `<!doctype html><html><head><title>Contact Us</title></head><body>
      <main><article>
        <h1>Contact Us</h1>
        <p>Email: support@example.test</p>
        <p>Phone: (555) 123-4567</p>
        <p>Office hours: Monday to Friday, 9am-5pm.</p>
      </article></main>
    </body></html>`,
    schema: {
      type: "object",
      properties: {
        email: { type: "string" },
        phone: { type: "string" },
      },
      required: ["email", "phone"],
    },
    expectedData: { email: "support@example.test", phone: "(555) 123-4567" },
  },
  {
    name: "event-details",
    html: `<!doctype html><html><head><title>Annual Backend Engineering Summit</title></head><body>
      <main><article>
        <h1>Annual Backend Engineering Summit</h1>
        <p>Date: June 12, 2026</p>
        <p>Location: Austin, TX</p>
        <p>Ticket price: $199</p>
      </article></main>
    </body></html>`,
    schema: {
      type: "object",
      properties: {
        eventName: { type: "string" },
        location: { type: "string" },
        priceUsd: { type: "number" },
      },
      required: ["eventName", "location", "priceUsd"],
    },
    expectedData: {
      eventName: "Annual Backend Engineering Summit",
      location: "Austin, TX",
      priceUsd: 199,
    },
  },
  {
    name: "job-posting",
    html: `<!doctype html><html><head><title>Senior Backend Engineer</title></head><body>
      <main><article>
        <h1>Senior Backend Engineer</h1>
        <p>Location: Remote</p>
        <p>Salary range: $140,000 - $180,000</p>
        <p>Requires 5+ years of experience with distributed systems.</p>
      </article></main>
    </body></html>`,
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        remote: { type: "boolean" },
      },
      required: ["title", "remote"],
    },
    expectedData: { title: "Senior Backend Engineer", remote: true },
  },
];
