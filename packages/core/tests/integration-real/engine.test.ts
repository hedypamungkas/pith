import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  startTestHtmlServer,
  type TestServerHandle,
} from "../helpers/testServer.js";

vi.mock("../../src/fetch/ssrfGuard.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/fetch/ssrfGuard.js")>();
  return { ...actual, assertPublicHost: vi.fn().mockResolvedValue(undefined) };
});

import { createEngine, NotConfiguredError } from "../../src/index.js";

describe("createEngine SDK", () => {
  let server: TestServerHandle;

  beforeAll(async () => {
    server = await startTestHtmlServer();
  });
  afterAll(async () => {
    await server.close();
  });

  it("scrape returns markdown from a real loopback page on the static tier", async () => {
    const engine = createEngine();
    const result = await engine.scrape(server.url);
    expect(result.tierUsed).toBe("static");
    expect(result.markdown).toContain("real content that should survive extraction");
    expect(result.title).toBe("Sample Article");
  });

  it("extract throws NotConfiguredError without a backend", async () => {
    const engine = createEngine();
    await expect(
      engine.extract("https://x.test", { type: "object" }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("search throws NotConfiguredError without a backend", async () => {
    const engine = createEngine();
    await expect(engine.search("q")).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("extract runs end-to-end with a stubbed backend (verified citation -> not flagged)", async () => {
    const extract = vi.fn().mockResolvedValue({
      data: { title: "Sample Article" },
      confidence: { title: 0.95 },
      citations: {
        title: { quote: "real content that should survive extraction", supportScore: 0.9 },
      },
      model: "stub-model",
    });
    const engine = createEngine({ extractionBackend: { extract } });
    const r = await engine.extract(server.url, {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
    });
    expect(r.data.title).toBe("Sample Article");
    expect(r.flaggedFields).toEqual([]); // confidence 0.95 + verified citation
    expect(r.citations.title?.verified).toBe(true);
    expect(r.model).toBe("stub-model");
    expect(extract).toHaveBeenCalled();
  });
});
