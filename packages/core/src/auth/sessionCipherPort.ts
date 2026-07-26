// StorageState is defined once in src/types.ts (shared by the fetch tier and
// this crypto tier); re-exported here so the cipher's own public surface keeps
// exporting it for existing import paths.
import type { StorageState } from "../types.js";
export type { StorageState };

export interface EncryptedSessionBlob {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

/**
 * Port for encrypting/decrypting a Playwright storageState at rest. Generic
 * crypto — the only shipped implementation (EnvKeySessionCipher, AES-256-GCM)
 * is keyed off caller-supplied key material; a KMS-backed implementation
 * (via the KmsKeyProvider port) drops in without touching call sites.
 */
export interface SessionCipher {
  encrypt(plaintext: StorageState): EncryptedSessionBlob;
  decrypt(blob: EncryptedSessionBlob): StorageState;
  /** The key_version a freshly-encrypted blob is stamped with — this
   * implementation's current signing key, distinct from whichever older
   * version(s) it can still decrypt. */
  readonly currentKeyVersion: number;
}
