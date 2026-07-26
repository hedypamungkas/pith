import type { KmsKeyProvider } from "./kmsKeyProviderPort.js";

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Prod adapter. Unwraps a DEK by POSTing its Vault Transit ciphertext to
 * `${addr}/v1/${mount}/decrypt/${keyName}` and base64-decoding the returned
 * plaintext — envelope encryption, where the KEK never leaves Vault. No
 * provider SDK: Vault's small, stable Transit REST surface is spoken directly
 * over fetch with an AbortController timeout.
 *
 * Constructed with a version → wrapped-DEK-ciphertext map; versions not in the
 * map return `null` so the factory falls back to the local provider for legacy
 * blobs. Each version is unwrapped at most once per process (cached).
 */
export class VaultTransitKeyProvider implements KmsKeyProvider {
  private readonly cache = new Map<number, Buffer>();

  constructor(
    private readonly addr: string,
    private readonly token: string,
    private readonly keyName: string,
    private readonly wrappedByVersion: ReadonlyMap<number, string>,
    private readonly mount = "transit",
  ) {}

  async unwrapDek(version: number): Promise<Buffer | null> {
    const cached = this.cache.get(version);
    if (cached) return cached;
    const ciphertext = this.wrappedByVersion.get(version);
    if (!ciphertext) return null;
    const plaintext = await this.decrypt(ciphertext);
    const dek = Buffer.from(plaintext, "base64");
    this.cache.set(version, dek);
    return dek;
  }

  private async decrypt(ciphertext: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${this.addr}/v1/${this.mount}/decrypt/${this.keyName}`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Vault-Token": this.token,
        },
        body: JSON.stringify({ ciphertext }),
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Vault Transit decrypt returned ${response.status}: ${text.slice(0, 500)}`,
      );
    }
    const body = (await response.json()) as { data?: { plaintext?: string } };
    if (!body.data?.plaintext) {
      throw new Error(
        "Vault Transit decrypt returned no plaintext for the given ciphertext",
      );
    }
    return body.data.plaintext;
  }
}
