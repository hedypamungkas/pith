import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Engine } from "../engine.js";
import { FRESHNESS_VALUES } from "../search/searchPort.js";
import { NotConfiguredError } from "../errors.js";
import { errMsg, type HandlerResult } from "./handlerResult.js";

export const searchRequestSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(10),
  freshness: z.enum(FRESHNESS_VALUES).optional(),
});

export async function handleSearchRequest(
  input: unknown,
  engine: Engine,
): Promise<HandlerResult> {
  const requestId = randomUUID();
  const parsed = searchRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { requestId, error: parsed.error.message, errorKind: "client" };
  }
  try {
    const response = await engine.search(parsed.data.query, {
      limit: parsed.data.limit,
      freshness: parsed.data.freshness,
    });
    return { requestId, body: { ...response } };
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return { requestId, error: errMsg(err), errorKind: "notConfigured" };
    }
    return { requestId, error: errMsg(err), errorKind: "upstream" };
  }
}
