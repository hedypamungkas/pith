import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface CrawlTestSiteHandle {
  url: string;
  close: () => Promise<void>;
}

// Long enough to clear the 200-char thin-content threshold in scrapeUrl.ts,
// so these tests exercise the static tier deterministically without ever
// needing a real headless escalation.
function page(title: string, links: string[]): string {
  const anchors = links.map((href) => `<a href="${href}">${href}</a>`).join(" ");
  return `<!doctype html><html><head><title>${title}</title></head><body><main><article><h1>${title}</h1><p>Real content for ${title}, long enough to avoid the thin-content escalation heuristic that would otherwise trigger a headless fetch during these crawl orchestration tests, since we want deterministic static-tier-only behavior here.</p>${anchors}</article></main></body></html>`;
}

async function listen(server: Server): Promise<CrawlTestSiteHandle> {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/**
 * A small linked site graph for exercising multi-page crawl discovery:
 * / -> /a, /b ; /a -> /c ; /c -> / (cycle, dedup) and an off-domain link
 * (same-domain-only bound). Used by the "crawls a small linked site" test.
 */
export async function startCrawlTestSite(): Promise<CrawlTestSiteHandle> {
  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    switch (path) {
      case "/":
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page("Root", ["/a", "/b"]));
        return;
      case "/a":
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page("Page A", ["/c"]));
        return;
      case "/b":
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page("Page B", []));
        return;
      case "/c":
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page("Page C", ["/", "https://external.example.test/other"]));
        return;
      default:
        res.writeHead(404);
        res.end("not found");
    }
  });

  return listen(server);
}

export const AUTH_COOKIE_NAME = "session";
export const AUTH_COOKIE_VALUE = "authed-value";

/**
 * Serves member content only when the request carries the expected auth
 * cookie, a login stub otherwise — for authenticated-crawl tests. Two
 * pages so a mid-crawl revocation test has a second, not-yet-processed page
 * to observe getting blocked. `rootDelayMs` delays only the root page's
 * response — gives a mid-crawl-revocation test a reliable window to revoke
 * after the root page's own per-page session check already passed (it's
 * already "in flight") but before the discovered second page's own,
 * fresh check runs.
 */
export async function startAuthGatedTestSite(rootDelayMs = 0): Promise<CrawlTestSiteHandle> {
  const isAuthed = (req: import("node:http").IncomingMessage) =>
    (req.headers.cookie ?? "").includes(`${AUTH_COOKIE_NAME}=${AUTH_COOKIE_VALUE}`);

  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    const respond = () => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (!isAuthed(req)) {
        res.end(page("Please Log In", []));
        return;
      }
      if (path === "/") {
        res.end(page("Member Content", ["/second"]));
        return;
      }
      res.end(page("Member Second Page", []));
    };
    if (path === "/" && rootDelayMs > 0) {
      setTimeout(respond, rootDelayMs);
    } else {
      respond();
    }
  });

  return listen(server);
}

/**
 * Member content at "/" always links to "/expired", which unconditionally
 * (regardless of cookie) 302-redirects to "/login" — simulating a session
 * that was valid when the crawl started but expired mid-crawl. A
 * reauthUrlPattern of "**\/login" matches the resulting finalUrl. Used by the
 * reauth-pause/resume integration tests.
 */
export async function startExpiringAuthGatedTestSite(): Promise<CrawlTestSiteHandle> {
  const isAuthed = (req: import("node:http").IncomingMessage) =>
    (req.headers.cookie ?? "").includes(`${AUTH_COOKIE_NAME}=${AUTH_COOKIE_VALUE}`);

  // Only the FIRST request to /expired trips the reauth trap — models a
  // session that was genuinely valid when the crawl started, "expired" at
  // that moment, and (once the test's own /reauth resubmission "logs it
  // back in") succeeds normally on the retry the resumer re-enqueues.
  let expiredHits = 0;

  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    if (path === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(isAuthed(req) ? page("Member Content", ["/expired"]) : page("Please Log In", []));
      return;
    }
    if (path === "/expired") {
      expiredHits += 1;
      if (expiredHits === 1) {
        res.writeHead(302, { Location: "/login" });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page("Expired Page, Now Fine", []));
      return;
    }
    if (path === "/login") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page("Please Log In", []));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  return listen(server);
}

/**
 * A site with one deliberately slow page, for the worker-crash/resume test:
 * / -> /fast, /slow. /slow doesn't respond until `slowDelayMs` has elapsed,
 * giving the test a reliable window to force-kill a worker while that page
 * is still in flight.
 */
export async function startCrashTestSite(slowDelayMs: number): Promise<CrawlTestSiteHandle> {
  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    if (path === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page("Root", ["/fast", "/slow"]));
      return;
    }
    if (path === "/fast") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page("Fast Page", []));
      return;
    }
    if (path === "/slow") {
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page("Slow Page", []));
      }, slowDelayMs);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  return listen(server);
}

/**
 * A site whose page bodies embed a caller-supplied subject identifier (e.g. an
 * email), so a data-subject scan can find + erase "content about a person."
 * Two pages (root + /a) so the test exercises both a crawl (2 page objects)
 * and a single-page scrape against the same subject id. Long enough to clear
 * the thin-content threshold so the static tier handles it deterministically.
 */
export async function startSubjectTestSite(subjectId: string): Promise<CrawlTestSiteHandle> {
  const subjectPage = (title: string, links: string[]) => {
    const anchors = links.map((href) => `<a href="${href}">${href}</a>`).join(" ");
    return `<!doctype html><html><head><title>${title}</title></head><body><main><article><h1>${title}</h1><p>Profile for data subject ${subjectId}: this page is about a person and must be findable and erasable by a data-subject access/erasure request. Long enough to clear the thin-content threshold so the static tier handles it deterministically without a headless escalation.</p>${anchors}</article></main></body></html>`;
  };
  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    if (path === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(subjectPage("Subject Root", ["/a"]));
      return;
    }
    if (path === "/a") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(subjectPage("Subject Page A", []));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  return listen(server);
}
