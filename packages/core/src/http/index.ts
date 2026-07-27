import type { FastifyInstance, FastifyReply } from "fastify";
import type { Engine } from "../engine.js";
import {
  handleScrapeRequest,
  handleExtractRequest,
  handleSearchRequest,
  handleCrawlRequest,
  handleGetCrawlStatus,
  type HandlerResult,
} from "../handlers/index.js";

export interface HttpServerOptions {
  engine: Engine;
}

function statusFor(errorKind?: HandlerResult["errorKind"]): number {
  switch (errorKind) {
    case "client":
      return 400;
    case "capExceeded":
      return 402;
    case "notConfigured":
      return 503;
    default:
      return 502;
  }
}

/**
 * `@pith/core/http` — the optional Fastify HTTP face over the same handlers the
 * MCP face uses. Fastify is a dynamic import so the main `@pith/core` entry
 * never requires it (an SDK-only consumer installs nothing extra).
 *
 *   const app = await createServer({ engine });
 *   await app.listen({ port: 3000 });
 */
export async function createServer(
  options: HttpServerOptions,
): Promise<FastifyInstance> {
  const { engine } = options;
  const Fastify = (await import("fastify")).default;
  const app: FastifyInstance = Fastify({ logger: false });

  app.get("/health", async () => ({ status: "ok" }));

  const send = async (reply: FastifyReply, promise: Promise<HandlerResult>) => {
    const result = await promise;
    if (result.error) {
      return reply
        .code(statusFor(result.errorKind))
        .send({ requestId: result.requestId, error: result.error });
    }
    return reply
      .code(200)
      .send({ requestId: result.requestId, ...(result.body ?? {}) });
  };

  app.post("/v1/scrape", async (req, reply) =>
    send(reply, handleScrapeRequest(req.body, engine)),
  );
  app.post("/v1/extract", async (req, reply) =>
    send(reply, handleExtractRequest(req.body, engine)),
  );
  app.post("/v1/search", async (req, reply) =>
    send(reply, handleSearchRequest(req.body, engine)),
  );
  app.post("/v1/crawl", async (req, reply) => {
    const r = await handleCrawlRequest(req.body, engine);
    if ("error" in r) return reply.code(400).send(r);
    return reply.code(202).send(r);
  });
  app.get("/v1/crawl/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const status = await handleGetCrawlStatus(id, engine);
    if (!status) return reply.code(404).send({ error: "Crawl not found" });
    return reply.code(200).send(status);
  });

  return app;
}
