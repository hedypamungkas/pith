import { NotImplementedError } from "../errors.js";

/**
 * `@pith/core/http` — the optional Fastify HTTP face over the same pure
 * handlers as the SDK and MCP faces (`/v1/scrape`, `/v1/crawl`, `/v1/search`,
 * `/v1/extract`). Lands in spin-off step 3.
 */
export function createServer(): never {
  throw new NotImplementedError("@pith/core/http — createServer");
}
