/**
 * Pith MCP server — stdio bridge.
 *
 * `buildMcpServer` returns a standard MCP server; this wires it to a stdio
 * transport so any MCP-capable client (Claude Desktop, Cursor, …) can spawn it
 * as a subprocess and drive the 5 tools (scrape / search / crawl /
 * get_crawl_status / extract).
 *
 * Run (after `npm install` + `npm run build` in the repo):
 *   npx tsx examples/mcp/server.ts
 *
 * Requires `@modelcontextprotocol/sdk` (an optional peer of @pith/core).
 */
import { createEngine } from "@pith/core";
import { buildMcpServer } from "@pith/core/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = await buildMcpServer({
  // Pass extractionBackend / searchBackend here if you want extract/search tools
  // to do real work — by default they surface a notConfigured error.
  engine: createEngine(),
});

await server.connect(new StdioServerTransport());
