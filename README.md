# Pith

> The essential web, for agents. Clean, LLM-ready content from any URL — scrape, crawl, structured extract, and search, with verifiable citations and deterministic request replay.

**Status: scaffold (v0.0.0).** This repository currently contains only the package skeleton, the dependency-injection spine (`createEngine` + in-memory/null ports), the test-first quality gate, and the "no infrastructure on import" smoke gate. The engine modules land in subsequent steps — see [`docs/spin-off-plan.md`](./docs/spin-off-plan.md) in the source project for the full plan.

## Why Pith

Pith is the open-source core extracted from a production web-for-LLMs platform. It is a Firecrawl-equivalent engine (URL → clean Markdown, plus crawl, structured extraction, search, and an MCP server) with three differentiators carried over: defense-in-depth content cleaning (boilerplate strip before Readability), provider-agnostic verifiable extraction (per-field confidence + citation cross-checks), and deterministic request inspection/replay.

It runs with **zero infrastructure and zero API keys by default** — in-memory stores, in-process queue — with Postgres/MinIO/BullMQ/LLM providers available as optional adapters behind ports.

## Quickstart (zero env)

```bash
npm install
npm test            # unit + real + nock + smoke — green with no containers or keys
```

```ts
import { createEngine } from "@pith/core";

const pith = createEngine(); // zero-config, in-memory defaults
// await pith.scrape("https://example.com"); // engine lands in step 3
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).
