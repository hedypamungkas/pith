import { BraveSearchAdapter } from "./braveSearchAdapter.js";
import type { SearchBackend } from "./searchPort.js";

/**
 * Constructs the canonical Brave search backend. No singleton, no config — the
 * OSS core never assumes a provider; pass the API key explicitly. The prod
 * project wires this from its own config; tests inject a mock SearchBackend.
 */
export function createBraveSearchBackend(apiKey: string): SearchBackend {
  return new BraveSearchAdapter(apiKey);
}
