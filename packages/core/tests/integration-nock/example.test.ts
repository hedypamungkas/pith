import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import nock from "nock";

afterEach(() => {
  nock.cleanAll();
});

// Proves the nock harness is wired and intercepts outbound HTTP deterministically,
// key-free. NOTE: this skeleton uses node:http (which nock intercepts directly).
// The step-4 engine fixtures target the engine's own outbound fetch (undici) —
// whether nock intercepts fetch there is resolved in step 4 (nock undici support
// vs. an undici MockAgent); this file only validates the harness is installed.
describe("integration-nock: nock harness is wired", () => {
  it("intercepts an outbound HTTP request deterministically", async () => {
    const scope = nock("http://example.test")
      .get("/page")
      .reply(200, "<html><body><p>hello</p></body></html>", {
        "content-type": "text/html; charset=utf-8",
      });

    const body = await new Promise<string>((resolveBody, reject) => {
      const req = http.get("http://example.test/page", (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => resolveBody(data));
      });
      req.on("error", reject);
    });

    expect(body).toContain("hello");
    expect(scope.isDone()).toBe(true);
  });
});
