# Pith

> The essential web, for agents. URL → clean markdown, crawl, structured extract, and search — with verifiable citations and deterministic request replay.

[![CI](https://github.com/pith-core/pith/actions/workflows/ci.yml/badge.svg)](https://github.com/pith-core/pith/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@pith/core.svg)](https://www.npmjs.com/package/@pith/core)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@pith/core.svg)](https://www.npmjs.com/package/@pith/core)
[![downloads](https://img.shields.io/npm/dm/@pith/core.svg)](https://www.npmjs.com/package/@pith/core)

Pith is an open-source web-for-LLMs engine: point it at a URL and get clean, LLM-ready markdown — plus multi-page crawl, provider-agnostic structured extraction (with per-field confidence and citations you can verify), web search, and an MCP server. It runs with **zero infrastructure and zero API keys by default**: in-memory stores, an in-process queue, no database, no object store, no job runner. Postgres / MinIO / BullMQ / LLM providers are optional adapters behind explicit [ports](./docs/ARCHITECTURE.md).

It's the core of a production web-for-LLMs platform, carved out as a library you can embed or self-host.

## Install

```bash
npm install @pith/core
# optional peers, installed only if you use that face:
npm install fastify               # for @pith/core/http
npm install @modelcontextprotocol/sdk zod-to-json-schema  # for @pith/core/mcp
npm install playwright            # for the headless fetch tier
```

## Quickstart (SDK, zero env)

```ts
import { createEngine } from "@pith/core";

const pith = createEngine();          // in-memory defaults — no keys, no containers

// Scrape: static → headless escalation, boilerplate stripped before Readability.
const page = await pith.scrape("https://example.com");
console.log(page.markdown);

// Crawl: same-domain bounded, dedup, worker-death resumable.
const handle = await pith.crawl("https://example.com", { maxDepth: 2, maxPages: 25 });
const status = await handle.wait();   // drains to a terminal status

// Structured extract + verifiable citations (needs a backend — see below).
const backend = createEngine({
  extractionBackend: createExtractionBackend({
    baseUrl: process.env.EXTRACTION_BASE_URL!,
    apiKey: process.env.EXTRACTION_API_KEY!,
    model: process.env.EXTRACTION_MODEL!,
  }),
});
const { data, confidence, citations, flaggedFields } = await backend.extract(
  "https://example.com",
  { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
);
```

`createEngine()` with no arguments works immediately. `extract` and `search` throw `NotConfiguredError` until you pass a backend — Pith never assumes a billable provider.

## The three faces

| Face | Import | What it is |
|---|---|---|
| **SDK** | `@pith/core` | `createEngine()` — call `scrape` / `crawl` / `extract` / `search` in-process. |
| **HTTP** | `@pith/core/http` | `createServer({ engine })` — a Fastify app exposing `/health` + `/v1/scrape`, `/v1/crawl`, `/v1/crawl/:id`, `/v1/search`, `/v1/extract`. See [`docs/openapi.yaml`](./docs/openapi.yaml). |
| **MCP** | `@pith/core/mcp` | `buildMcpServer({ engine })` — 5 tools: `scrape`, `search`, `crawl`, `get_crawl_status`, `extract`. Speaks the MCP protocol to any client. |

```ts
// HTTP
import { createEngine } from "@pith/core";
import { createServer } from "@pith/core/http";
const app = await createServer({ engine: createEngine() });
await app.listen({ port: 3000, host: "127.0.0.1" });

// MCP
import { buildMcpServer } from "@pith/core/mcp";
const server = await buildMcpServer({ engine: createEngine() });
// …connect the SDK's StreamableHTTPServerTransport (see examples/mcp/)
```

### Use it from any MCP client (e.g. Claude Desktop)

`buildMcpServer({ engine })` returns a standard MCP server — connect it to any transport. The simplest is a small stdio bridge ([`examples/mcp/server.ts`](./examples/mcp/server.ts)):

```jsonc
// examples/mcp/claude_desktop_config.json  (run from the repo root, or adjust the path)
{
  "mcpServers": {
    "pith": { "command": "npx", "args": ["tsx", "./examples/mcp/server.ts"] }
  }
}
```

The 5 tools (`scrape`, `search`, `crawl`, `get_crawl_status`, `extract`) then appear in the client. Full setup in [`examples/mcp/`](./examples/mcp).

## Configuration

Everything is optional. Pith ships no default billable endpoint.

| Env var | Face / feature | Notes |
|---|---|---|
| `EXTRACTION_API_KEY` | extract | Required to enable structured extraction. |
| `EXTRACTION_BASE_URL` | extract | OpenAI-compatible endpoint. The accuracy benchmark defaults to `https://api.openai.com/v1`. |
| `EXTRACTION_MODEL` | extract | e.g. `gpt-4o-mini`. |
| `BRAVE_API_KEY` | search | Required to enable the Brave search backend. |
| `freshnessTier` (per-request) | scrape | Opt into stale-while-revalidate caching (`"news"` / `"standard"`); see [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). |

See [`.env.example`](./.env.example) for the full list (zero required).

## Why Pith

- **Defense-in-depth content cleaning** — boilerplate is stripped *before* Readability runs, so the reader sees real article text, not nav chrome.
- **Provider-agnostic, verifiable extraction** — every field carries a confidence score (FR-4) and a citation; citations are independently re-verified against the page's own text (FR-8), so hallucinated quotes are caught, not just claimed against. Works against any OpenAI-compatible endpoint.
- **Tier escalation** — static fetch first, headless only when the result is thin or the static fetch fails; a budget ceiling can decline an escalation that has a cheaper fallback.
- **Deterministic request inspection / replay** — every request is snapshot-able and replayable.
- **Opt-in freshness** — stale-while-revalidate scrape cache with a monotonically-tightening tier model.
- **Test-first quality gate** — a 5-project Vitest matrix (unit / smoke / integration-real / integration-nock / accuracy) stays green key-free on every PR; the 20-fixture extraction accuracy benchmark runs nightly (key-gated), hard-asserting ≥90% field accuracy and ≥90% citation verification against real model output.

## Architecture

Pith is **one core, three faces**. Every host concern (cost metering, request snapshots, crawl state, content blobs, the job queue, robots resolution, the freshness cache, the clock) is an injectable [port](./docs/ARCHITECTURE.md) with an in-memory / no-op default. Swap in real adapters without touching engine logic.

```text
                 ┌──────────── createEngine() ────────────┐
   SDK ─────────▶│ scrape · crawl · extract · search      │
   HTTP ────────▶│ (one request-handling core, shared)    │◀─▶ CorePorts (8 ports, null defaults)
   MCP  ────────▶│                                        │     └ real adapters optional (PG/MinIO/BullMQ/…)
                 └────────────────────────────────────────┘
```

Read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the port table, the "no infrastructure on import" invariant, and the carve-out boundary.

## Examples

- [`examples/quickstart.ts`](./examples/quickstart.ts) — Node/TS SDK (scrape, crawl, extract, search).
- [`examples/langchain_agent.py`](./examples/langchain_agent.py) — a LangChain agent driving Pith's MCP tools (search → scrape → extract).
- [`examples/mcp/`](./examples/mcp/) — MCP client config (Claude Desktop).

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Quick rules enforced in CI: no infrastructure on import, test-first (the matrix stays green key-free), no secrets / no real crawled HTML. Security issues: see [`SECURITY.md`](./SECURITY.md) — do **not** open a public issue.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
