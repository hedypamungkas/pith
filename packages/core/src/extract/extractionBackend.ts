import { OpenAiCompatibleExtractionAdapter } from "./openAiCompatibleExtractionAdapter.js";
import type { ExtractionBackend } from "./extractionPort.js";

export interface ExtractionBackendOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Constructs the canonical OpenAI-compatible extraction backend. No singleton,
 * no config — the OSS core never assumes a provider or reads environment; pass
 * explicit credentials. The prod project wires this from its own config at
 * startup; tests inject a mock ExtractionBackend.
 */
export function createExtractionBackend(
  options: ExtractionBackendOptions,
): ExtractionBackend {
  return new OpenAiCompatibleExtractionAdapter(
    options.baseUrl,
    options.apiKey,
    options.model,
  );
}
