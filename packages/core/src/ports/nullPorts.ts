import type { CorePorts } from "./corePorts.js";

/**
 * No-op / in-memory defaults for every port. `createEngine()` with no arguments
 * uses exactly these, so the engine runs with zero infrastructure out of the
 * box. The in-memory stores here are intentionally minimal and correct; their
 * full semantics (serialized maxPages enforcement, LRU caps, TTL expiry, worker
 * resume) are fleshed out in spin-off step 5 as engine tests demand them.
 */

class NoopCostRecorder {
  recordAttempts(_attempts: unknown[]): void {
    /* records nothing */
  }
  recordCostEvent(_event: unknown): void {
    /* records nothing */
  }
  hasCostEventForRequest(_requestId: string): boolean {
    // Idempotency sees a fresh request when nothing is recorded.
    return false;
  }
  getCostCentsForRequest(_requestId: string): number {
    return 0;
  }
}

class InMemorySnapshotStore {
  private readonly store = new Map<string, unknown>();
  capture(snapshot: unknown): void {
    if (snapshot && typeof snapshot === "object" && "requestId" in snapshot) {
      const requestId = (snapshot as { requestId: string }).requestId;
      this.store.set(requestId, snapshot);
    }
  }
  load(requestId: string): unknown {
    return this.store.get(requestId);
  }
}

class InMemoryCrawlStateStore {
  // No internal map yet: every method is a minimal-correct stub. Full state
  // (jobs + pages + serialized maxPages enforcement) lands in spin-off step 5.
  createCrawl(input: unknown): unknown {
    return input;
  }
  markPageStatus(_crawlId: string, _pageId: string, _status: string): void {
    /* no-op until step 5 */
  }
  insertDiscoveredPages(_crawlId: string, _urls: string[]): unknown {
    return undefined;
  }
  finalizeCrawlIfDone(_crawlId: string): boolean {
    return true;
  }
  getPageStatus(_crawlId: string, _pageId: string): string {
    return "pending";
  }
  listPausedPages(_authSessionId: string): unknown[] {
    return [];
  }
}

class InMemoryContentStore {
  private readonly blobs = new Map<string, Uint8Array | string>();
  put(key: string, body: Uint8Array | string): void {
    this.blobs.set(key, body);
  }
  get(key: string): Uint8Array | string | undefined {
    return this.blobs.get(key);
  }
  list(prefix: string): string[] {
    return [...this.blobs.keys()].filter((k) => k.startsWith(prefix));
  }
  delete(key: string): void {
    this.blobs.delete(key);
  }
}

class InProcessJobDriver {
  addScrape(payload: unknown): unknown {
    return payload;
  }
  addCrawlPage(payload: unknown): unknown {
    return payload;
  }
  addExtract(payload: unknown): unknown {
    return payload;
  }
  wait(payload: unknown): unknown {
    return payload;
  }
}

class AllowAllRobotsResolver {
  isAllowed(_url: string): boolean {
    // Placeholder default: the real robotsGuard (with SSRF-validated fetch +
    // spec-compliant fail-open) ports in step 2 and becomes the default.
    return true;
  }
}

class InMemoryFreshnessCache {
  private readonly cache = new Map<string, unknown>();
  tryGet(url: string): unknown {
    return this.cache.get(url) ?? null;
  }
  record(input: unknown): void {
    if (input && typeof input === "object" && "url" in input) {
      this.cache.set((input as { url: string }).url, input);
    }
  }
  listDue(): unknown[] {
    return [];
  }
}

export function createNullPorts(): CorePorts {
  return {
    costRecorder: new NoopCostRecorder(),
    snapshotStore: new InMemorySnapshotStore(),
    crawlStateStore: new InMemoryCrawlStateStore(),
    contentStore: new InMemoryContentStore(),
    queue: new InProcessJobDriver(),
    robotsResolver: new AllowAllRobotsResolver(),
    freshnessCache: new InMemoryFreshnessCache(),
    clock: () => new Date(),
  };
}
