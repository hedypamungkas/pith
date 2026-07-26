import { NotImplementedError } from "./errors.js";
import type { CorePorts } from "./ports/corePorts.js";
import { createNullPorts } from "./ports/nullPorts.js";

export interface Engine {
  /** The resolved, fully-populated port set (null defaults + caller overrides). */
  ports: CorePorts;
  /** Single-page scrape (static → headless escalation). Lands in step 3. */
  scrape(url: string, opts?: unknown): never;
  /** Multi-page crawl orchestration. Lands in step 3. */
  crawl(url: string, opts?: unknown): never;
  /** Provider-agnostic structured extraction + citation verification. Step 3. */
  extract(url: string, schema: unknown, opts?: unknown): never;
  /** Search via an injected SearchBackend. Step 3. */
  search(query: string, opts?: unknown): never;
}

/**
 * Construct a Pith engine. With no arguments it runs entirely on in-memory /
 * no-op ports — zero infrastructure, zero API keys. Pass partial overrides to
 * swap in real adapters (Postgres state, MinIO content, BullMQ queue, a real
 * ExtractionBackend / SearchBackend, etc.).
 *
 *   const pith = createEngine();                       // zero-config
 *   const pith = createEngine({ crawlStateStore: pgAdapter });
 */
export function createEngine(overrides: Partial<CorePorts> = {}): Engine {
  const ports: CorePorts = { ...createNullPorts(), ...overrides };
  const notYet = (feature: string): never => {
    throw new NotImplementedError(feature);
  };
  return {
    ports,
    scrape: (_url: string, _opts?: unknown) => notYet("engine.scrape"),
    crawl: (_url: string, _opts?: unknown) => notYet("engine.crawl"),
    extract: (_url: string, _schema: unknown, _opts?: unknown) =>
      notYet("engine.extract"),
    search: (_query: string, _opts?: unknown) => notYet("engine.search"),
  };
}
