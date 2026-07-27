import { describe, it, expect } from "vitest";
import { createEngine, NotConfiguredError } from "../../src/index.js";

describe("createEngine wiring", () => {
  it("returns an engine with fully-populated null ports", () => {
    const engine = createEngine();
    expect(engine.ports.clock()).toBeInstanceOf(Date);
    expect(engine.ports.costRecorder.hasCostEventForRequest("req_1")).toBe(false);
    expect(engine.ports.robotsResolver.isAllowed("https://example.com")).toBe(true);
  });

  it("merges caller overrides over the null defaults", () => {
    const customNow = new Date("2026-01-01T00:00:00Z");
    const engine = createEngine({ clock: () => customNow });
    expect(engine.ports.clock()).toBe(customNow);
    // Non-overridden ports still come from createNullPorts().
    expect(engine.ports.costRecorder.hasCostEventForRequest("x")).toBe(false);
  });

  it("extract/search reject with NotConfiguredError without a backend", async () => {
    const engine = createEngine();
    await expect(
      engine.extract("https://example.com", { type: "object" }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(engine.search("query")).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("crawl returns a handle (wait() drains to completion; exercised in integration)", async () => {
    const engine = createEngine();
    const handle = await engine.crawl("https://example.com");
    expect(handle.crawlId).toBeTruthy();
    expect(typeof handle.wait).toBe("function");
  });
});
