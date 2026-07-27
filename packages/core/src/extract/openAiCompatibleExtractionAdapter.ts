import { compileExtractionSchema, ajv } from "./schemaValidation.js";
import type { ExtractionBackend, ExtractionResult, ModelCitation } from "./extractionPort.js";
// LOW_CONFIDENCE_THRESHOLD now lives on the extraction port (canonical home);
// re-exported here for one major version so external consumers importing it
// from the adapter path keep compiling.
import { LOW_CONFIDENCE_THRESHOLD } from "./extractionPort.js";

const TOOL_NAME = "record_extraction";
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Speaks the OpenAI Chat Completions wire format directly over fetch, with no
 * provider SDK — works against any OpenAI-compatible endpoint (OpenAI itself,
 * Groq, Together, Fireworks, OpenRouter, local vLLM/Ollama, or Anthropic's own
 * OpenAI-compatibility layer) by configuring baseUrl, apiKey, and model.
 */
export class OpenAiCompatibleExtractionAdapter implements ExtractionBackend {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async extract(
    markdown: string,
    text: string,
    schema: Record<string, unknown>,
  ): Promise<ExtractionResult> {
    const validateAgainstSchema = compileExtractionSchema(schema);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: `Extract structured data matching the required schema from the page content below. If a value isn't present or you're unsure, still provide your best value but give it a low confidence score rather than omitting it. For each field, also record a citation: a verbatim quote copied from the PLAIN TEXT block (never the Markdown block) that supports the value, per the tool description's exact rules.\n\n--- MARKDOWN (structure/context) ---\n${markdown}\n--- END MARKDOWN ---\n\n--- PLAIN TEXT (quote citations verbatim from here only) ---\n${text}\n--- END PLAIN TEXT ---`,
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: TOOL_NAME,
                description:
                  "Records the extracted data, a confidence score per field, and a citation per field.",
                parameters: buildToolParameters(schema),
              },
            },
          ],
          tool_choice: { type: "function", function: { name: TOOL_NAME } },
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Extraction backend returned ${response.status}: ${body.slice(0, 500)}`);
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const toolCall = payload.choices?.[0]?.message?.tool_calls?.find(
      (call) => call.function?.name === TOOL_NAME,
    );
    if (!toolCall?.function?.arguments) {
      throw new Error("Model did not return a tool call for extraction");
    }

    let input: {
      data: Record<string, unknown>;
      confidence: Record<string, number>;
      citations?: Record<string, Partial<ModelCitation>>;
    };
    try {
      input = JSON.parse(toolCall.function.arguments);
    } catch (err) {
      throw new Error(
        `Model tool call arguments were not valid JSON: ${(err as Error).message}`,
      );
    }

    if (!validateAgainstSchema(input.data)) {
      throw new Error(
        `Model output did not conform to the requested schema: ${ajv.errorsText(validateAgainstSchema.errors)}`,
      );
    }

    const confidence = input.confidence ?? {};
    const rawCitations = input.citations ?? {};
    const citations: Record<string, ModelCitation> = {};
    // Fail-safe, not just fail-fast: any field the model returned in `data` but
    // didn't score/cite is treated as unscored/uncited rather than implicitly
    // certain. An uncited field defaults to an empty quote, which
    // citationVerifier always treats as unverified.
    for (const field of Object.keys(input.data)) {
      if (!(field in confidence)) {
        confidence[field] = 0;
      }
      const claimed = rawCitations[field];
      citations[field] = {
        quote: typeof claimed?.quote === "string" ? claimed.quote : "",
        supportScore:
          typeof claimed?.supportScore === "number" ? claimed.supportScore : 0,
      };
    }

    return {
      data: input.data,
      confidence,
      citations,
      model: this.model,
    };
  }
}

function fieldNames(callerSchema: Record<string, unknown>): string[] {
  const properties = callerSchema.properties;
  return properties && typeof properties === "object" ? Object.keys(properties) : [];
}

function buildToolParameters(callerSchema: Record<string, unknown>): Record<string, unknown> {
  const citationSchema = {
    type: "object",
    properties: {
      quote: { type: "string" },
      supportScore: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["quote", "supportScore"],
  };
  return {
    type: "object",
    properties: {
      data: callerSchema,
      confidence: {
        type: "object",
        description:
          "Map of top-level field name to a 0-1 confidence score for how certain you are that field's value is correct. Must include an entry for every field in `data`.",
        properties: Object.fromEntries(
          fieldNames(callerSchema).map((name) => [
            name,
            { type: "number", minimum: 0, maximum: 1 },
          ]),
        ),
        required: fieldNames(callerSchema),
        additionalProperties: { type: "number", minimum: 0, maximum: 1 },
      },
      citations: {
        type: "object",
        description:
          "Map of top-level field name to a citation supporting that field's value. `quote` must be a VERBATIM copy of a contiguous span from the PLAIN TEXT block (never the Markdown block, never paraphrased) — if nothing on the page supports the value, set quote to an empty string. `supportScore` is a 0-1 score for how strongly that quote backs the claim. Must include an entry for every field in `data`.",
        properties: Object.fromEntries(
          fieldNames(callerSchema).map((name) => [name, citationSchema]),
        ),
        required: fieldNames(callerSchema),
        additionalProperties: citationSchema,
      },
    },
    required: ["data", "confidence", "citations"],
  };
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      tool_calls?: Array<{
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
}

/**
 * @deprecated Import LOW_CONFIDENCE_THRESHOLD from the extraction port
 * (`@use-pith/core`'s `extractionPort`). Re-exported here for one major version
 * for consumers importing it from the adapter path.
 */
export { LOW_CONFIDENCE_THRESHOLD };
