import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Real loopback HTTP on purpose — this suite tests robots.txt fetch/parse/cache
// mechanics, not the SSRF guard (unit/ssrfGuard.test.ts covers that).
vi.mock("../../src/fetch/ssrfGuard.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/fetch/ssrfGuard.js")>();
  return { ...actual, assertPublicHost: vi.fn().mockResolvedValue(undefined) };
});

import { createRobotsResolver } from "../../src/fetch/robotsGuard.js";
import { ROBOTS_USER_AGENT_TOKEN } from "../../src/fetch/userAgent.js";

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe("createRobotsResolver", () => {
  let disallowingServer: Server;
  let disallowingOrigin: string;
  let missingServer: Server;
  let missingOrigin: string;

  beforeAll(async () => {
    disallowingServer = createServer((req, res) => {
      if (req.url === "/robots.txt") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(`User-agent: ${ROBOTS_USER_AGENT_TOKEN}\nDisallow: /private\n`);
        return;
      }
      res.writeHead(200);
      res.end("ok");
    });
    disallowingOrigin = await listen(disallowingServer);

    missingServer = createServer((_req, res) => {
      res.writeHead(404);
      res.end("not found");
    });
    missingOrigin = await listen(missingServer);
  });

  afterAll(async () => {
    await new Promise((resolve) => disallowingServer.close(resolve));
    await new Promise((resolve) => missingServer.close(resolve));
  });

  it("disallows a path a site's robots.txt blocks for this bot's user-agent", async () => {
    const robots = createRobotsResolver();
    expect(await robots.isAllowed(`${disallowingOrigin}/private/secret`)).toBe(
      false,
    );
  });

  it("allows a path not covered by any Disallow rule", async () => {
    const robots = createRobotsResolver();
    expect(await robots.isAllowed(`${disallowingOrigin}/public/page`)).toBe(true);
  });

  it("allows everything when robots.txt is missing (404)", async () => {
    const robots = createRobotsResolver();
    expect(await robots.isAllowed(`${missingOrigin}/anything`)).toBe(true);
  });

  it("caches robots.txt within the TTL and refreshes after expiry (injected clock)", async () => {
    let fetchCount = 0;
    const countingServer = createServer((req, res) => {
      if (req.url === "/robots.txt") {
        fetchCount += 1;
        res.writeHead(200);
        res.end("");
        return;
      }
      res.writeHead(200);
      res.end("ok");
    });
    const origin = await listen(countingServer);

    let clock = 1_000_000;
    const robots = createRobotsResolver({ cacheTtlMs: 1000, clock: () => clock });

    await robots.isAllowed(`${origin}/a`);
    await robots.isAllowed(`${origin}/b`); // cached — no new fetch
    expect(fetchCount).toBe(1);

    clock += 2000; // advance past the TTL
    await robots.isAllowed(`${origin}/c`); // refresh
    expect(fetchCount).toBe(2);

    await new Promise((r) => countingServer.close(r));
  });
});
