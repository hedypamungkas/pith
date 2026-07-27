import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import {
  startTestHtmlServer,
  type TestServerHandle,
} from "../helpers/testServer.js";
import { createEngine } from "../../src/index.js";
import { createServer } from "../../src/http/index.js";

vi.mock("../../src/fetch/ssrfGuard.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/fetch/ssrfGuard.js")>();
  return { ...actual, assertPublicHost: vi.fn().mockResolvedValue(undefined) };
});

describe("@use-pith/core/http", () => {
  let htmlServer: TestServerHandle;
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    htmlServer = await startTestHtmlServer();
    app = await createServer({ engine: createEngine() });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await htmlServer.close();
  });

  it("GET /health", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });

  it("POST /v1/scrape returns markdown from a loopback page", async () => {
    const res = await fetch(`${baseUrl}/v1/scrape`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: htmlServer.url }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.markdown).toContain("real content that should survive extraction");
  });

  it("POST /v1/extract without a backend returns 503 (notConfigured)", async () => {
    const res = await fetch(`${baseUrl}/v1/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: htmlServer.url, schema: { type: "object" } }),
    });
    expect(res.status).toBe(503);
  });

  it("POST /v1/crawl kicks off (202) and GET status reaches complete", async () => {
    const res = await fetch(`${baseUrl}/v1/crawl`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: htmlServer.url, maxDepth: 0, maxPages: 1 }),
    });
    expect(res.status).toBe(202);
    const { crawlId } = (await res.json()) as { crawlId: string };

    let status: { status?: string; pagesSucceeded?: number } = {};
    for (let i = 0; i < 50; i++) {
      const r = await fetch(`${baseUrl}/v1/crawl/${crawlId}`);
      status = await r.json();
      if (status.status === "complete" || status.status === "failed") break;
      await new Promise((rb) => setTimeout(rb, 100));
    }
    expect(status.status).toBe("complete");
    expect(status.pagesSucceeded).toBe(1);
  }, 15_000);
});
