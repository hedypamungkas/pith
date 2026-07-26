import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SessionCipher, EncryptedSessionBlob, StorageState } from "./sessionCipherPort.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // GCM's recommended nonce size

/**
 * AES-256-GCM keyed off a version → raw 32-byte key map. Source-agnostic: the
 * key material is supplied by the caller (a factory, or directly) and may
 * originate from env vars (local mode) or from KMS-unwrapped DEKs (vault mode).
 * An unwrapped DEK is structurally identical to a raw key, which is why this
 * same class serves both.
 *
 * Rotation is structural, not a pipeline: ops adds a new version's key,
 * configures it as the new currentKeyVersion, and keeps the old key reachable
 * at its old version via keysByVersion — no bulk re-encryption job. Old blobs
 * keep decrypting under their stamped key_version for as long as that version
 * stays configured.
 */
export class EnvKeySessionCipher implements SessionCipher {
  constructor(
    private readonly keysByVersion: ReadonlyMap<number, Buffer>,
    public readonly currentKeyVersion: number,
  ) {
    if (!keysByVersion.has(currentKeyVersion)) {
      throw new Error(`No key configured for currentKeyVersion ${currentKeyVersion}`);
    }
  }

  encrypt(plaintext: StorageState): EncryptedSessionBlob {
    const key = this.keysByVersion.get(this.currentKeyVersion)!;
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const json = Buffer.from(JSON.stringify(plaintext), "utf8");
    const ciphertext = Buffer.concat([cipher.update(json), cipher.final()]);
    return {
      ciphertext,
      iv,
      authTag: cipher.getAuthTag(),
      keyVersion: this.currentKeyVersion,
    };
  }

  decrypt(blob: EncryptedSessionBlob): StorageState {
    const key = this.keysByVersion.get(blob.keyVersion);
    if (!key) {
      throw new Error(
        `No key configured for key_version ${blob.keyVersion} — cannot decrypt`,
      );
    }
    const decipher = createDecipheriv(ALGORITHM, key, blob.iv);
    decipher.setAuthTag(blob.authTag); // throws at final() on tamper or wrong key
    const plaintext = Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  }
}
