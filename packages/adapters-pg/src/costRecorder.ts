import type { CostRecorder } from "@use-pith/core";
import { centsForTier, type ScrapeAttempt } from "@use-pith/core";
import type { Queryable } from "./queryable.js";

/**
 * The expected shape of a `recordCostEvent` payload. The port types `event` as
 * `unknown` (the OSS core owns no billing schema); this adapter reads it
 * best-effort. A `{ requestId, cents }` entry is the requestId-linked ledger
 * row the MCP/HTTP cost overlay's `getCostCentsForRequest` sums.
 */
interface CostEventInput {
  requestId: string;
  cents: number;
  tier?: string;
  success?: boolean;
}

/**
 * Postgres-backed {@link CostRecorder} over the `cost_events` ledger.
 *
 * Two write paths mirror the two port methods:
 *  - {@link recordAttempts}: raw per-attempt metering. The OSS engine calls
 *    this without a requestId in scope, so rows are written with
 *    `request_id NULL` — a persistent aggregate ledger (attempt counts /
 *    success rate by tier), never summed by the per-request lookups.
 *  - {@link recordCostEvent}: the requestId-linked billing entry the cost
 *    overlay reads. Accepts `{ requestId, cents, tier?, success? }`.
 *
 * Failed attempts bill 0 cents (`centsForTier` applied only on success) —
 * verbatim from the core's pricing rule.
 */
export class PgCostRecorder implements CostRecorder {
  constructor(private readonly client: Queryable) {}

  async recordAttempts(attempts: ScrapeAttempt[]): Promise<void> {
    if (attempts.length === 0) return;
    const params: unknown[] = [];
    const tuples = attempts
      .map((a) => {
        const cents = a.success ? centsForTier(a.tier) : 0;
        const base = params.length;
        params.push(a.tier, a.success, cents);
        return `($${base + 1}::text, $${base + 2}::boolean, $${base + 3}::integer)`;
      })
      .join(", ");
    await this.client.query(
      `INSERT INTO cost_events (tier, success, cents) VALUES ${tuples}`,
      params,
    );
  }

  async recordCostEvent(event: unknown): Promise<void> {
    // A null/undefined payload means "nothing to record" — the one genuinely
    // idempotent no-op. Any other shape is validated loudly: this is a billing
    // RPC (invoked by hosts/MCP, NOT by the OSS engine), so a malformed entry
    // must surface rather than silently write 0 cents or be dropped — the cost
    // overlay sums this ledger into real invoices.
    if (event == null) return;
    const e = event as Partial<CostEventInput>;
    if (typeof e.requestId !== "string" || e.requestId === "") {
      throw new Error(
        `PgCostRecorder.recordCostEvent: expected { requestId: string, cents: number }; requestId missing or invalid in ${JSON.stringify(event)}`,
      );
    }
    if (typeof e.cents !== "number" || !Number.isFinite(e.cents)) {
      // A string/undefined/null/NaN/Infinity cents previously coerced to 0 and
      // wrote a silent 0-cent row — billing corruption. Reject it.
      throw new Error(
        `PgCostRecorder.recordCostEvent: invalid cents for requestId=${e.requestId}: ${String(e.cents)}`,
      );
    }
    if (!Number.isInteger(e.cents)) {
      // The column is `integer`; silently flooring a float would lose money.
      // Force the caller to round upstream so the loss is explicit.
      throw new Error(
        `PgCostRecorder.recordCostEvent: fractional cents not allowed for requestId=${e.requestId} (got ${e.cents}); round upstream`,
      );
    }
    await this.client.query(
      `INSERT INTO cost_events (request_id, tier, success, cents)
       VALUES ($1, $2, $3, $4)`,
      [e.requestId, e.tier ?? "static", e.success ?? true, e.cents],
    );
  }

  async hasCostEventForRequest(requestId: string): Promise<boolean> {
    const { rows } = await this.client.query<{ present: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM cost_events WHERE request_id = $1) AS present`,
      [requestId],
    );
    return rows[0]?.present === true;
  }

  async getCostCentsForRequest(requestId: string): Promise<number> {
    const { rows } = await this.client.query<{ total: string | number | null }>(
      `SELECT COALESCE(SUM(cents), 0) AS total FROM cost_events WHERE request_id = $1`,
      [requestId],
    );
    const total = rows[0]?.total;
    if (total === null || total === undefined) return 0;
    return Number(total);
  }
}

/** Thin factory mirroring core's `createExtractionBackend` / `createBraveSearchBackend`. */
export function createPgCostRecorder(client: Queryable): PgCostRecorder {
  return new PgCostRecorder(client);
}
