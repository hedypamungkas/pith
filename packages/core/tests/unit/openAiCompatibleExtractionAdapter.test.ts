import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { fakeFetch } = vi.hoisted(() => ({ fakeFetch: vi.fn() }));
vi.stubGlobal("fetch", fakeFetch);

import { OpenAiCompatibleExtractionAdapter } from "../../src/extract/openAiCompatibleExtractionAdapter.js";
import { InvalidExtractionSchemaError } from "../../src/extract/extractionPort.js";

const schema = {
  type: "object",
  properties: {
    title: { type: "string" },
    author: { type: "string" },
  },
  required: ["title", "author"],
};

function chatCompletionResponse(toolArguments: unknown) {
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: "record_extraction",
                  arguments: JSON.stringify(toolArguments),
                },
              },
            ],
          },
        },
      ],
    }),
  };
}

describe("OpenAiCompatibleExtractionAdapter", () => {
  beforeEach(() => {
    fakeFetch.mockClear();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("calls the configured base URL's chat/completions endpoint with a bearer token", async () => {
    fakeFetch.mockResolvedValueOnce(
      chatCompletionResponse({
        data: { title: "Sample Article", author: "Jamie Rivera" },
        confidence: { title: 0.95, author: 0.9 },
        citations: {
          title: { quote: "Sample Article", supportScore: 0.9 },
          author: { quote: "By Jamie Rivera", supportScore: 0.85 },
        },
      }),
    );

    const adapter = new OpenAiCompatibleExtractionAdapter(
      "https://example-provider.test/v1",
      "test-api-key",
      "some-model",
    );
    await adapter.extract(
      "# Sample Article\nBy Jamie Rivera",
      "Sample Article\nBy Jamie Rivera",
      schema,
    );

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const [url, init] = fakeFetch.mock.calls[0]!;
    expect(url).toBe("https://example-provider.test/v1/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer test-api-key",
    });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("some-model");
    expect(body.tool_choice).toEqual({
      type: "function",
      function: { name: "record_extraction" },
    });
  });

  it("fails safe when the model omits a confidence score for a returned field", async () => {
    fakeFetch.mockResolvedValueOnce(
      chatCompletionResponse({
        data: { title: "Sample Article", author: "Jamie Rivera" },
        confidence: { title: 0.95 },
        citations: { title: { quote: "Sample Article", supportScore: 0.9 } },
      }),
    );

    const adapter = new OpenAiCompatibleExtractionAdapter(
      "https://api.test/v1",
      "key",
      "model",
    );
    const result = await adapter.extract(
      "# Sample Article\nBy Jamie Rivera",
      "Sample Article\nBy Jamie Rivera",
      schema,
    );

    expect(result.confidence.title).toBe(0.95);
    expect(result.confidence.author).toBe(0);
  });

  it("fails safe when the model omits a citation for a returned field", async () => {
    fakeFetch.mockResolvedValueOnce(
      chatCompletionResponse({
        data: { title: "Sample Article", author: "Jamie Rivera" },
        confidence: { title: 0.95, author: 0.9 },
        citations: { title: { quote: "Sample Article", supportScore: 0.9 } },
      }),
    );

    const adapter = new OpenAiCompatibleExtractionAdapter(
      "https://api.test/v1",
      "key",
      "model",
    );
    const result = await adapter.extract(
      "# Sample Article\nBy Jamie Rivera",
      "Sample Article\nBy Jamie Rivera",
      schema,
    );

    expect(result.citations.title).toEqual({ quote: "Sample Article", supportScore: 0.9 });
    expect(result.citations.author).toEqual({ quote: "", supportScore: 0 });
  });

  it("rejects a malformed caller schema before ever calling the model", async () => {
    const adapter = new OpenAiCompatibleExtractionAdapter(
      "https://api.test/v1",
      "key",
      "model",
    );
    await expect(
      adapter.extract("content", "content", { type: "not-a-real-json-schema-type" }),
    ).rejects.toBeInstanceOf(InvalidExtractionSchemaError);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("throws if the model output doesn't conform to the caller's schema", async () => {
    fakeFetch.mockResolvedValueOnce(
      chatCompletionResponse({
        data: { title: "Sample Article" }, // missing required `author`
        confidence: { title: 0.9 },
        citations: { title: { quote: "Sample Article", supportScore: 0.9 } },
      }),
    );

    const adapter = new OpenAiCompatibleExtractionAdapter(
      "https://api.test/v1",
      "key",
      "model",
    );
    await expect(adapter.extract("content", "content", schema)).rejects.toThrow(
      /did not conform/,
    );
  });

  it("throws a clear error when the endpoint returns a non-2xx response", async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "invalid api key",
    });

    const adapter = new OpenAiCompatibleExtractionAdapter(
      "https://api.test/v1",
      "bad-key",
      "model",
    );
    await expect(adapter.extract("content", "content", schema)).rejects.toThrow(/401/);
  });

  it("throws a clear error when no tool call is returned", async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: {} }] }),
    });

    const adapter = new OpenAiCompatibleExtractionAdapter(
      "https://api.test/v1",
      "key",
      "model",
    );
    await expect(adapter.extract("content", "content", schema)).rejects.toThrow(
      /did not return a tool call/,
    );
  });
});
