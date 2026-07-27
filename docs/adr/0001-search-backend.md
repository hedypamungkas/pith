# ADR 0001: Search backend

**Status:** Accepted

## Context

FR-3 requires search results served via a licensed/aggregated backend — never
via unlicensed scraping of another engine's SERPs. Unlicensed SERP scraping is
legally exposed — recent DMCA actions have targeted exactly that model — and
it isn't a foundation to build a product on.

The platform's first milestone called for a bake-off among licensed backends
with the choice documented.

## Candidates considered

- **Brave Search API** — independent, non-scraped index; transparent
  per-request pricing ($5/1K search requests); simple REST API with a
  single subscription-token header; generous-enough free credit to develop
  against without a payment commitment blocking early milestones.
- **DataForSEO** — broader engine coverage (multiple SERP sources) but a
  more complex request/response model and pricing structure; better fit
  once there's a concrete need for multi-engine coverage than for an MVP
  proving the core scrape/crawl/extract flow.

## Decision

Wire the **Brave Search API**. It's the simplest backend to integrate
correctly on day one, its pricing is the easiest to reason about for the
cost-instrumentation work, and it's verifiably not exposed to the SERP-scraping
legal risk described in FR-3.

## Scope note

This decision covers the Brave adapter (`src/search/braveSearchAdapter.ts`)
used to prove the integration works. The public `/v1/search` route that
exposes this to API callers, with freshness filters and result ranking, is
later work — it wires the *already-chosen* backend into a route and does not
reopen this decision.

The adapter sits behind a `SearchBackend` port, so the backend remains
swappable: a future driver can be added without touching any caller that
depends on the port.

## Revisit if

- Brave's per-request pricing or free-tier terms change materially, or
- A concrete customer need for multi-engine coverage emerges that Brave's
  single index can't serve.
