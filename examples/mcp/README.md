# Pith over MCP

`@use-pith/core/mcp`'s `buildMcpServer({ engine })` returns a standard MCP server exposing five tools: `scrape`, `search`, `crawl`, `get_crawl_status`, `extract`. Connect it to any MCP transport.

## Stdio (recommended for desktop clients)

`server.ts` is a 10-line stdio bridge. Build the repo, then point a client at it.

**Claude Desktop** — merge into `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your platform:

```jsonc
{
  "mcpServers": {
    "pith": { "command": "npx", "args": ["tsx", "/absolute/path/to/pith/examples/mcp/server.ts"] }
  }
}
```

Use an absolute path (desktop clients don't run from your repo root). Restart the client; the five Pith tools become available.

## Streamable HTTP (optional)

For a network-accessible server, connect the same `buildMcpServer` result to a `StreamableHTTPServerTransport` behind your own HTTP host (the `@use-pith/core/http` Fastify face serves the REST `/v1/*` surface, **not** `/mcp` — mount the MCP transport separately if you need it on the same port). See the MCP SDK docs for the transport setup.

## Enabling extract / search

By default `scrape` and `crawl` work key-free; `extract` and `search` surface a `notConfigured` error until you pass backends:

```ts
const server = await buildMcpServer({
  engine: createEngine({
    extractionBackend: createExtractionBackend({ baseUrl, apiKey, model }),
    searchBackend: createBraveSearchBackend(apiKey),
  }),
});
```
