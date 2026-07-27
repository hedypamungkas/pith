import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  startTestHtmlServer,
  type TestServerHandle,
} from "../helpers/testServer.js";
import { createEngine } from "../../src/index.js";
import { callTool, buildMcpServer } from "../../src/mcp/index.js";

vi.mock("../../src/fetch/ssrfGuard.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/fetch/ssrfGuard.js")>();
  return { ...actual, assertPublicHost: vi.fn().mockResolvedValue(undefined) };
});

describe("@use-pith/core/mcp", () => {
  let htmlServer: TestServerHandle;
  let engine: ReturnType<typeof createEngine>;

  beforeAll(async () => {
    htmlServer = await startTestHtmlServer();
    engine = createEngine();
  });
  afterAll(async () => {
    await htmlServer.close();
  });

  it("buildMcpServer returns an MCP server", async () => {
    const server = await buildMcpServer({ engine });
    expect(server).toBeTruthy();
  });

  it("callTool('scrape') returns markdown via structuredContent", async () => {
    const result = await callTool("scrape", { url: htmlServer.url }, engine);
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as { markdown: string };
    expect(payload.markdown).toContain("real content that should survive extraction");
  });

  it("callTool('extract') without a backend surfaces a notConfigured error", async () => {
    const result = await callTool(
      "extract",
      { url: htmlServer.url, schema: { type: "object" } },
      engine,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/extractionBackend|not configured/i);
  });

  it("callTool for an unknown name returns isError", async () => {
    const result = await callTool("nope", {}, engine);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/Unknown tool/);
  });
});
