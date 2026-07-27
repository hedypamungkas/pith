# `@use-pith/core`

> The essential web, for agents. URL→clean markdown, crawl, structured extract, search, and an MCP server — provider-agnostic, with verifiable citations.

```bash
npm install @use-pith/core
```

```ts
import { createEngine } from "@use-pith/core";

const pith = createEngine();              // zero-config: in-memory stores, no API keys
const page = await pith.scrape("https://example.com");
console.log(page.markdown);               // clean, LLM-ready markdown
```

`@use-pith/core` is the embeddable engine. It runs with **zero infrastructure and zero API keys by default** (in-memory ports, in-process queue). Opt into persistence, LLM extraction, search, and HTTP/MCP faces as you need them.

- **Three faces:** the SDK (`createEngine`), `@use-pith/core/http` (Fastify `/v1/*`), `@use-pith/core/mcp` (5 MCP tools).
- **Differentiators:** boilerplate strip before Readability; provider-agnostic extraction with per-field confidence + independently-verifiable citations; static→headless tier escalation; opt-in freshness (stale-while-revalidate); opt-in MCP cost overlay.

📘 **Full docs:** [root README](../../README.md) · [Architecture](../../docs/ARCHITECTURE.md) · [OpenAPI](../../docs/openapi.yaml) · [Examples](../../examples/)

Apache-2.0.
