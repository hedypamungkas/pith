# Examples

- **`langchain_agent.py`** — Python LangChain agent that drives the Pith MCP
  server's tools (search, scrape, crawl, extract) end-to-end over MCP.
  Run: `pip install -r requirements.txt`, set the env vars documented in the
  file's module docstring, then `python3 langchain_agent.py`.
- **`quickstart.ts`** — Node/TypeScript quickstart using the `@use-pith/core` SDK
  against the REST API. Run: `npx tsx quickstart.ts`.
- **`mcp/`** — Ready-to-paste MCP client configuration (e.g. Claude Desktop)
  pointing at the `@use-pith/core/http` MCP endpoint. Copy the relevant block
  into your client's config and set `PITH_API_KEY`.
