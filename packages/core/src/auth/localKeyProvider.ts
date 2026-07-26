import type { KmsKeyProvider } from "./kmsKeyProviderPort.js";

/**
 * Dev/test/CI adapter — and the carrier for legacy raw keys during a Vault
 * migration. Unwrapping is an in-memory map lookup over raw 32-byte keys: no
 * KMS, no network, no I/O. A Vault-mode deployment still constructs one of
 * these (seeded with the pre-migration key + retired keys) so blobs encrypted
 * before the cutover stay decryptable — the factory tries the Vault provider
 * first and falls back to this one for legacy versions.
 */
export class LocalKeyProvider implements KmsKeyProvider {
  constructor(private readonly keysByVersion: ReadonlyMap<number, Buffer>) {}

  async unwrapDek(version: number): Promise<Buffer | null> {
    return this.keysByVersion.get(version) ?? null;
  }
}
