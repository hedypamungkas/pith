import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// The engine's SSRF guard blocks loopback (127.0.0.0/8). The core
// integration-real tests stub it the same way — and since we import createEngine
// from core's SOURCE (not dist), the mock intercepts the internal module.
vi.mock("../../../core/src/fetch/ssrfGuard.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../core/src/fetch/ssrfGuard.js")>();
  return { ...actual, assertPublicHost: vi.fn().mockResolvedValue(undefined) };
});

import { createEngine } from "../../../core/src/index.js";
import { pgFromEnv, type PgHandle } from "../helpers/pg.js";
import {
  PgCrawlStateStore,
  PgCostRecorder,
  PgSnapshotStore,
} from "../../src/index.js";

// The headline proof: crawl state a PG-backed engine writes is readable by a
// fresh engine on the SAME pool — i.e. it persisted, not just stayed in memory.
// Gated (needs PG_DATABASE_URL); runs in adapters-nightly.yml.
describe.skipIf(!process.env.PG_DATABASE_URL)(
  "PG-backed engine restart survival",
  () => {
    let pg: PgHandle;
    let server: Server;
    let url: string;

    beforeAll(async () => {
      pg = await pgFromEnv();
      const page = (title: string, links: string[]) =>
        `<!doctype html><html><head><title>${title}</title></head><body><main><article><h1>${title}</h1><p>Real content for ${title}, long enough to clear the static-tier thin-content threshold so this restart-survival crawl stays on the static tier deterministically and never escalates to the headless browser tier, which would otherwise require a launched browser this test does not stand up.</p>${links
          .map((h) => `<a href="${h}">${h}</a>`)
          .join(" ")}</article></main></body></html>`;
      server = createServer((req, res) => {
        const path = req.url ?? "/";
        if (path === "/") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(page("Root", ["/a", "/b"]));
          return;
        }
        if (path === "/a") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(page("Page A", []));
          return;
        }
        if (path === "/b") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(page("Page B", []));
          return;
        }
        res.writeHead(404);
        res.end("not found");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await pg.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("crawl state written by one engine is readable by a fresh engine on the same pool", async () => {
      // engine 1 — PG-backed crawl state, cost recorder, and snapshots.
      const engine1 = createEngine({
        crawlStateStore: new PgCrawlStateStore(pg.client),
        costRecorder: new PgCostRecorder(pg.client),
        snapshotStore: new PgSnapshotStore(pg.client),
      });
      const handle = await engine1.crawl(`${url}/`, {
        maxDepth: 2,
        maxPages: 10,
      });
      const status1 = await handle.wait();
      expect(status1.status).toBe("complete");
      expect(status1.pagesSucceeded).toBe(3); // root, /a, /b

      // engine 2 — a brand-new engine on the SAME pool, zero in-memory carryover.
      const engine2 = createEngine({
        crawlStateStore: new PgCrawlStateStore(pg.client),
        snapshotStore: new PgSnapshotStore(pg.client),
      });
      const status2 = await engine2.ports.crawlStateStore.getCrawlStatus(
        handle.crawlId,
      );
      expect(status2).not.toBeNull();
      expect(status2!.status).toBe("complete");
      expect(status2!.pagesSucceeded).toBe(status1.pagesSucceeded);
      expect(status2!.pagesTotal).toBe(status1.pagesTotal);

      // Snapshots persisted too: at least one request snapshot was captured.
      const pages = await engine2.ports.crawlStateStore.listPages(handle.crawlId);
      const snap = pages.find((p) => p.requestId)?.requestId;
      expect(snap).toBeTruthy();
      const loaded = await engine2.ports.snapshotStore.load(snap!);
      expect(loaded).toBeDefined();
    });
  },
);
