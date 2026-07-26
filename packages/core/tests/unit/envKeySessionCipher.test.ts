import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EnvKeySessionCipher } from "../../src/auth/envKeySessionCipher.js";
import type { StorageState } from "../../src/auth/sessionCipherPort.js";

const SAMPLE_STATE: StorageState = {
  cookies: [
    {
      name: "session",
      value: "abc123",
      domain: "app.example.com",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ],
  origins: [
    {
      origin: "https://app.example.com",
      localStorage: [{ name: "token", value: "xyz" }],
    },
  ],
};

function makeCipher(version = 1): EnvKeySessionCipher {
  return new EnvKeySessionCipher(new Map([[version, randomBytes(32)]]), version);
}

describe("EnvKeySessionCipher", () => {
  it("round-trips a storageState blob", () => {
    const cipher = makeCipher();
    const encrypted = cipher.encrypt(SAMPLE_STATE);
    const decrypted = cipher.decrypt(encrypted);
    expect(decrypted).toEqual(SAMPLE_STATE);
  });

  it("stamps every encrypted blob with the cipher's current key version", () => {
    const cipher = makeCipher(3);
    const encrypted = cipher.encrypt(SAMPLE_STATE);
    expect(encrypted.keyVersion).toBe(3);
  });

  it("uses a fresh random IV per encryption (no ciphertext/IV reuse)", () => {
    const cipher = makeCipher();
    const first = cipher.encrypt(SAMPLE_STATE);
    const second = cipher.encrypt(SAMPLE_STATE);
    expect(first.iv.equals(second.iv)).toBe(false);
    expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
  });

  it("throws on decrypt if the auth tag was tampered with", () => {
    const cipher = makeCipher();
    const encrypted = cipher.encrypt(SAMPLE_STATE);
    const tamperedTag = Buffer.from(encrypted.authTag);
    tamperedTag[0] = tamperedTag[0]! ^ 0xff;
    expect(() => cipher.decrypt({ ...encrypted, authTag: tamperedTag })).toThrow();
  });

  it("throws on decrypt if the ciphertext was tampered with", () => {
    const cipher = makeCipher();
    const encrypted = cipher.encrypt(SAMPLE_STATE);
    const tamperedCiphertext = Buffer.from(encrypted.ciphertext);
    tamperedCiphertext[0] = tamperedCiphertext[0]! ^ 0xff;
    expect(() => cipher.decrypt({ ...encrypted, ciphertext: tamperedCiphertext })).toThrow();
  });

  it("throws a clear error when asked to decrypt an unconfigured key_version", () => {
    const cipher = makeCipher(1);
    const encrypted = cipher.encrypt(SAMPLE_STATE);
    expect(() => cipher.decrypt({ ...encrypted, keyVersion: 99 })).toThrow(/key_version 99/);
  });

  it("can still decrypt a blob encrypted under a retired key version", () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const oldCipher = new EnvKeySessionCipher(new Map([[1, oldKey]]), 1);
    const encryptedUnderOld = oldCipher.encrypt(SAMPLE_STATE);

    const rotatedCipher = new EnvKeySessionCipher(
      new Map([
        [1, oldKey],
        [2, newKey],
      ]),
      2,
    );
    expect(rotatedCipher.decrypt(encryptedUnderOld)).toEqual(SAMPLE_STATE);

    const freshlyEncrypted = rotatedCipher.encrypt(SAMPLE_STATE);
    expect(freshlyEncrypted.keyVersion).toBe(2);
  });

  it("throws at construction if no key is configured for currentKeyVersion", () => {
    expect(() => new EnvKeySessionCipher(new Map([[1, randomBytes(32)]]), 2)).toThrow(
      /currentKeyVersion 2/,
    );
  });
});
