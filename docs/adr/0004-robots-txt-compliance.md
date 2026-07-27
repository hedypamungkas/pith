# ADR 0004: robots.txt compliance (NFR-7/NFR-8)

**Status:** Accepted

## Context

The platform's review-readiness scope includes "robots.txt/GDPR posture."
Earlier, the platform fetched any public-internet host `ssrfGuard.ts` allowed,
with no regard for a site's own published crawl policy — acceptable for
closed-beta scope, not for review readiness.

## Decision

- **On by default.** robots.txt is consulted for every caller-supplied URL
  before fetch; the per-request opt-out is the exception, not the rule.
- **Library**: `robots-parser` (no types package exists upstream; a small
  ambient declaration lives at `src/types/robots-parser.d.ts`), not a
  hand-rolled parser — robots.txt's wildcard/precedence rules are
  standardized and easy to get subtly wrong by hand.
- **One check per top-level URL**: `scrapeUrl.ts` checks
  `isAllowedByRobots(url)` once, before either fetch tier, for the URL a
  caller actually asked for — not for every redirect hop or headless
  sub-resource request the way `ssrfGuard.ts` does. Robots.txt governs
  "should we crawl this URL at all," a decision made once against the
  caller's URL; SSRF governs "is this specific network request safe,"
  which is a different question asked at every hop. Conflating the two
  checks' cadence would either weaken SSRF's protection or make robots.txt
  compliance far more expensive than the spec requires.
- **User-agent identity**: `src/fetch/userAgent.ts` consolidates what were
  three duplicated `USER_AGENT` string literals (`staticFetcher.ts`,
  `headlessFetcher.ts`) into one source, plus a bare `ROBOTS_USER_AGENT_TOKEN`
  robots.txt `User-agent:` directives are matched against — robots.txt
  conventionally matches a bare product token, not a full UA string with
  version/comment.
- **Caching**: an in-memory, per-origin TTL cache
  (`config.ROBOTS_CACHE_TTL_MS`, default 1 hour) — no site expects
  sub-hour freshness on its own crawl policy, and re-fetching robots.txt on
  every single page of a crawl would be wasteful and could itself look like
  abusive traffic.
- **Fail open (spec-compliant)**: a missing, unreachable, malformed, or
  SSRF-blocked robots.txt all resolve to "allow all" — the standard
  convention for a missing robots.txt, applied uniformly to every other
  failure mode too, since the real fetch target is separately protected by
  `ssrfGuard.ts` regardless of what robots.txt says.
- **Per-request opt-out, logged**: `ignoreRobotsTxt` on `/v1/scrape`,
  `/v1/extract`, and `/v1/crawl` (applied to every page a crawl discovers,
  set once at crawl creation — not re-decided per page). Every use is
  logged to an append-only `robots_overrides` audit table
  (`api_key_id`, `url`, `created_at`), regardless of whether robots.txt
  would have actually disallowed the URL — the override itself is the
  auditable event, not just its consequence.

## Non-goals (explicitly deferred)

- Respecting `Crawl-delay` or `Sitemap:` directives — only `Disallow`/
  `Allow` rules for this bot's user-agent are consulted.
- A console/admin view over `robots_overrides` — the table exists for audit
  today; a UI is a later concern if overrides turn out to need active
  monitoring rather than after-the-fact audit.

## Revisit if

- A user needs `Crawl-delay` honored — would add a per-origin rate limit
  alongside the existing per-request concurrency semaphore in
  `headlessFetcher.ts`.
- The 1-hour cache TTL proves too stale for a site that changes its
  robots.txt reactively (e.g. in response to abusive traffic) — would
  need either a shorter default or a cache-busting signal.
