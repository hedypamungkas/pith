import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Engine } from "../engine.js";
import { compileExtractionSchema } from "../extract/schemaValidation.js";
import { InvalidExtractionSchemaError } from "../extract/extractionPort.js";
import { NotConfiguredError } from "../errors.js";
import { errMsg, type HandlerResult } from "./handlerResult.js";

export const extractRequestSchema = z.object({
  url: z.string().url(),
  schema: z.record(z.unknown()),
  budget_cents: z.number().int().min(0).optional(),
  ignoreRobotsTxt: z.boolean().default(false),
});

export async function handleExtractRequest(
  input: unknown,
  engine: Engine,
): Promise<HandlerResult> {
  const requestId = randomUUID();
  const parsed = extractRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { requestId, error: parsed.error.message, errorKind: "client" };
  }
  const { url, schema, budget_cents, ignoreRobotsTxt } = parsed.data;
  // Structural JSON-Schema validation -> client error before any fetch.
  try {
    compileExtractionSchema(schema);
  } catch (err) {
    if (err instanceof InvalidExtractionSchemaError) {
      return { requestId, error: errMsg(err), errorKind: "client" };
    }
    throw err;
  }
  try {
    const result = await engine.extract(url, schema, {
      budgetCents: budget_cents,
      ignoreRobotsTxt,
    });
    return { requestId, body: { ...result } };
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return { requestId, error: errMsg(err), errorKind: "notConfigured" };
    }
    return { requestId, error: errMsg(err), errorKind: "upstream" };
  }
}
