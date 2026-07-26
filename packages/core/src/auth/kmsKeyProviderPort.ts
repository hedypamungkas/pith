/**
 * Port for a key-custody provider that unwraps Data Encryption Keys (DEKs) for
 * the session vault. Two adapters ship: `LocalKeyProvider` (dev/test/CI — an
 * in-memory map lookup, no I/O) and `VaultTransitKeyProvider` (prod — a Vault
 * Transit decrypt over HTTP, no SDK). A future AWS/GCP KMS adapter would
 * implement this same port.
 */
export interface KmsKeyProvider {
  /**
   * Returns the raw 32-byte AES-256-GCM DEK for `version`, or `null` if this
   * provider has no key material for that version — the factory then falls back
   * to another provider (e.g. a pre-migration raw key via the local provider).
   * Implementations MUST cache the unwrapped DEK so a repeated call for the
   * same version never re-hits the KMS.
   */
  unwrapDek(version: number): Promise<Buffer | null>;
}
