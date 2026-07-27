# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-07-27

### Changed
- Dropped the npm `downloads` badge from the README (shields.io renders "package not found or too new" for a freshly-published package; it adds nothing yet).
- CI matrix Node `20, 22` → `22, 24`; release workflow Node `20` → `22` — silences the GitHub Actions "Node.js 20 is deprecated" runner warning.

No code or public-API changes.

## [0.1.0] - 2026-07-27

First public release of `@use-pith/core` — the open-source web-for-agents engine
extracted from a production web-for-LLMs platform. Pith turns any URL into
clean, LLM-ready Markdown, with crawl, provider-agnostic structured extraction,
web search, and an MCP server — all with zero infrastructure and zero API keys
by default.

### Added

- **Engine core** (`createEngine`):
  - **Scrape**: URL → clean Markdown via two-tier fetch with automatic
    static→headless escalation; defense-in-depth content cleaning strips
    boilerplate *before* running Readability.
  - **Crawl**: breadth/depth-bounded site traversal with URL deduplication and
    worker-death resume (crawls survive interruption and continue from where
    they left off).
  - **Structured extraction**: provider-agnostic (any OpenAI-compatible
    endpoint) schema-driven extraction returning per-field **confidence scores**
    and **verifiable citations** with source-span cross-checks.
  - **Web search**: pluggable search provider (Brave adapter included) feeding
    results back into scrape/extract.
- **Three consumption faces** over one engine:
  - **SDK** — `import { createEngine } from "@use-pith/core"`.
  - **HTTP** — `@use-pith/core/http`, a Fastify server exposing the OpenAPI-documented REST surface.
  - **MCP** — `@use-pith/core/mcp`, a Model Context Protocol server with 5 tools (scrape, crawl, extract, search, map).
- **Zero-infrastructure defaults** via a ports-and-adapters dependency-injection
  model: in-memory stores and an in-process queue work out of the box; Postgres,
  MinIO, BullMQ, and LLM/search providers are opt-in adapters. The package has
  no default API keys and no default billable endpoint — extraction/search throw
  `NotConfiguredError` until a provider is explicitly configured.
- **Opt-in freshness cache**: a stale-while-revalidate layer for fetched content,
  disabled by default.
- **Opt-in MCP cost overlay**: request/cost accounting hook for the MCP surface,
  disabled by default.
- **Test-first quality gate** (Vitest workspace):
  - Five projects: `unit`, `smoke`, `integration-nock`, `integration-real`, and
    `accuracy`.
  - The first four run **key-free** with no containers or API keys; the smoke
    project doubles as the "no infrastructure on import" gate.
  - A **20-fixture extraction accuracy benchmark** (`accuracy`) runs nightly and
    is gated behind provider keys — it never blocks a code change.
- **Hardening defaults**: an SSRF guard running on every fetch tier (including
  headless redirects and sub-resources) and `robots.txt` compliance on by
  default (spec-compliant, failing open only when unreachable).
- Repository scaffolding: Apache-2.0 license, Node `>=18.18.0` engine
  requirement, ESLint + Prettier + tsup build, and the CI/gitleaks/release
  workflows under `.github/`.

[Unreleased]: https://github.com/hedypamungkas/pith/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/hedypamungkas/pith/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/hedypamungkas/pith/releases/tag/v0.1.0
