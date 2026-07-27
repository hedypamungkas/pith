import { z } from "zod";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Engine } from "../engine.js";
import {
  scrapeRequestSchema,
  handleScrapeRequest,
  extractRequestSchema,
  handleExtractRequest,
  searchRequestSchema,
  handleSearchRequest,
  crawlRequestSchema,
  handleCrawlRequest,
  handleGetCrawlStatus,
} from "../handlers/index.js";

export interface McpServerOptions {
  engine: Engine;
}

type ToolDef = {
  name: string;
  description: string;
  inputSchema: unknown;
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent?: unknown;
};

function ok(payload: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}
function err(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

const getCrawlStatusSchema = z.object({ crawlId: z.string() });

/**
 * Dispatch a single MCP tool call against the engine. Exported so it is usable
 * directly (and testable) without standing up the MCP transport — buildMcpServer
 * wires this into the SDK's CallTool handler. No cost overlay: returns
 * `{ content, structuredContent }` without `cost_cents` / `budget_remaining_cents`.
 */
export async function callTool(
  name: string,
  rawArgs: unknown,
  engine: Engine,
): Promise<ToolResult> {
  if (name === "scrape" || name === "extract" || name === "search") {
    const handler =
      name === "scrape"
        ? handleScrapeRequest
        : name === "extract"
          ? handleExtractRequest
          : handleSearchRequest;
    const result = await handler(rawArgs, engine);
    if (result.error) return err(result.error);
    return ok({ requestId: result.requestId, ...(result.body ?? {}) });
  }
  if (name === "crawl") {
    const r = await handleCrawlRequest(rawArgs, engine);
    if ("error" in r) return err(r.error);
    return ok(r);
  }
  if (name === "get_crawl_status") {
    const parsed = getCrawlStatusSchema.safeParse(rawArgs);
    if (!parsed.success) return err(parsed.error.message);
    const status = await handleGetCrawlStatus(parsed.data.crawlId, engine);
    if (!status) return err(`Crawl not found: ${parsed.data.crawlId}`);
    return ok(status);
  }
  return err(`Unknown tool: ${name}`);
}

/**
 * `@pith/core/mcp` — the optional MCP face over the same handlers the HTTP face
 * uses (one request-handling core, two transports). Uses the SDK's low-level
 * `Server` + `setRequestHandler` API deliberately (registerTool's zod-compat
 * layer is brittle against some zod versions). `@modelcontextprotocol/sdk` and
 * `zod-to-json-schema` are dynamic imports (optional peers), so the main
 * `@pith/core` entry never requires them.
 */
export async function buildMcpServer(options: McpServerOptions): Promise<Server> {
  const { engine } = options;
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const {
    ListToolsRequestSchema,
    CallToolRequestSchema,
  } = await import("@modelcontextprotocol/sdk/types.js");
  const { zodToJsonSchema } = await import("zod-to-json-schema");

  // Cast the schema through never: zodToJsonSchema's generic over the Zod type
  // instantiates excessively deep under strict NodeNext. The runtime result is a
  // plain JSON Schema object either way.
  const toSchema = (schema: z.ZodType): unknown => zodToJsonSchema(schema as never);

  const TOOLS: ToolDef[] = [
    { name: "scrape", description: "Scrape a URL to clean markdown.", inputSchema: toSchema(scrapeRequestSchema) },
    { name: "search", description: "Web search via the configured backend.", inputSchema: toSchema(searchRequestSchema) },
    { name: "crawl", description: "Kick off a multi-page crawl.", inputSchema: toSchema(crawlRequestSchema) },
    { name: "get_crawl_status", description: "Poll a crawl's status.", inputSchema: toSchema(getCrawlStatusSchema) },
    { name: "extract", description: "Structured extraction per a JSON schema.", inputSchema: toSchema(extractRequestSchema) },
  ];

  const server = new Server(
    { name: "pith", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );
  // The SDK's setRequestHandler generics instantiate excessively deep under
  // strict NodeNext (the same brittleness that rules out registerTool). Register
  // via a loosely-typed helper that bypasses the generic inference; the handlers
  // are correctly shaped at runtime (the integration test drives them for real).
  const register = (schema: unknown, handler: unknown): void => {
    (
      server as unknown as {
        setRequestHandler: (schema: unknown, handler: unknown) => void;
      }
    ).setRequestHandler(schema, handler);
  };
  const listHandler = async (): Promise<{ tools: ToolDef[] }> => ({ tools: TOOLS });
  const callHandler = async (request: {
    params: { name: string; arguments?: unknown };
  }): Promise<ToolResult> =>
    callTool(request.params.name, request.params.arguments ?? {}, engine);
  register(ListToolsRequestSchema, listHandler);
  register(CallToolRequestSchema, callHandler);
  return server;
}
