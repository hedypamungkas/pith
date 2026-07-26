import { describe, it, expect } from "vitest";
import { createEngine, NotImplementedError } from "../../src/index.js";

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

  it("engine methods throw NotImplementedError until step 3", () => {
    const engine = createEngine();
    expect(() => engine.scrape("https://example.com")).toThrow(NotImplementedError);
    expect(() => engine.search("query")).toThrow(NotImplementedError);
  });
});
