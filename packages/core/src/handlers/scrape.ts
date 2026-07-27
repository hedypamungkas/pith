import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Engine } from "../engine.js";
import { fetchBudgetFrom } from "../fetchBudget.js";
import { errMsg, type HandlerResult } from "./handlerResult.js";

export const scrapeRequestSchema = z.object({
  url: z.string().url(),
  budget_cents: z.number().int().min(0).optional(),
  ignoreRobotsTxt: z.boolean().default(false),
});

export async function handleScrapeRequest(
  input: unknown,
  engine: Engine,
): Promise<HandlerResult> {
  const requestId = randomUUID();
  const parsed = scrapeRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { requestId, error: parsed.error.message, errorKind: "client" };
  }
  const { url, budget_cents, ignoreRobotsTxt } = parsed.data;
  try {
    const result = await engine.scrape(url, {
      budget: budget_cents !== undefined ? fetchBudgetFrom(budget_cents) : undefined,
      skipRobotsCheck: ignoreRobotsTxt,
    });
    return {
      requestId,
      body: {
        url: result.finalUrl,
        title: result.title,
        markdown: result.markdown,
        text: result.text,
        statusCode: result.statusCode,
        fetchedAt: result.fetchedAt,
        budgetDegradation: result.budgetDegradation,
      },
    };
  } catch (err) {
    return { requestId, error: errMsg(err), errorKind: "upstream" };
  }
}
