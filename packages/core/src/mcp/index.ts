import { NotImplementedError } from "../errors.js";

/**
 * `@pith/core/mcp` — the optional MCP face (scrape / crawl / extract / search
 * tools over Streamable HTTP), reusing the same pure handlers as the SDK and
 * HTTP faces. Also serves as a free language-agnostic client (any MCP client,
 * in any language, can drive Pith without a per-language SDK). Lands in step 3.
 */
export function buildMcpServer(): never {
  throw new NotImplementedError("@pith/core/mcp — buildMcpServer");
}
