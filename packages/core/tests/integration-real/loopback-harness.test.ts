import { describe, it, expect } from "vitest";
import { startTestHtmlServer } from "../helpers/testServer.js";

// Proves the real loopback harness (ported from the source project) works
// key-free: a genuine OS-assigned port, a real socket, a real fetch — no
// Chromium required at this stage. Browser-dependent skeletons land with the
// headless module in spin-off step 2.
describe("integration-real: loopback test server harness", () => {
  it("binds a real loopback port and serves the sample HTML", async () => {
    const server = await startTestHtmlServer();
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      const res = await fetch(server.url);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Sample Article");
    } finally {
      await server.close();
    }
  });
});
