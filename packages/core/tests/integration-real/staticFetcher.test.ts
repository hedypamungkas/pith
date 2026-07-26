import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Real loopback HTTP on purpose (fetch mechanics, not the SSRF guard). Stub
// only the host check so 127.0.0.1 is reachable; scheme check stays real.
vi.mock("../../src/fetch/ssrfGuard.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/fetch/ssrfGuard.js")>();
  return { ...actual, assertPublicHost: vi.fn().mockResolvedValue(undefined) };
});

import { fetchStatic, StaticFetchError } from "../../src/fetch/staticFetcher.js";

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe("fetchStatic", () => {
  let htmlServer: Server;
  let htmlOrigin: string;
  let redirectServer: Server;
  let redirectOrigin: string;
  let jsonServer: Server;
  let jsonOrigin: string;

  beforeAll(async () => {
    htmlServer = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><body><p>Sample Article</p></body></html>");
    });
    htmlOrigin = await listen(htmlServer);

    redirectServer = createServer((req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { Location: "/target" });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><body><p>redirected target</p></body></html>");
    });
    redirectOrigin = await listen(redirectServer);

    jsonServer = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
    jsonOrigin = await listen(jsonServer);
  });

  afterAll(async () => {
    await new Promise((r) => htmlServer.close(r));
    await new Promise((r) => redirectServer.close(r));
    await new Promise((r) => jsonServer.close(r));
  });

  it("fetches HTML from a live URL", async () => {
    const result = await fetchStatic(`${htmlOrigin}/`);
    expect(result.statusCode).toBe(200);
    expect(result.html).toContain("Sample Article");
    expect(result.fetchedAt).toBeTruthy();
  });

  it("follows a 302 redirect to the target", async () => {
    const result = await fetchStatic(`${redirectOrigin}/start`);
    expect(result.html).toContain("redirected target");
    expect(result.finalUrl).toContain("/target");
  });

  it("rejects a non-html content-type", async () => {
    await expect(fetchStatic(`${jsonOrigin}/`)).rejects.toBeInstanceOf(
      StaticFetchError,
    );
  });

  it("throws StaticFetchError on a non-listening host", async () => {
    await expect(
      fetchStatic("http://127.0.0.1:1/definitely-not-listening", 1000),
    ).rejects.toBeInstanceOf(StaticFetchError);
  });
});
