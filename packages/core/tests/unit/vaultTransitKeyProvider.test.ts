import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { VaultTransitKeyProvider } from "../../src/auth/vaultTransitKeyProvider.js";

const ADDR = "http://127.0.0.1:8200";
const TOKEN = "root-token";
const KEY_NAME = "sessions";
const CIPHERTEXT_V2 = "vault:v2:abc123";

function makeProvider(): VaultTransitKeyProvider {
  return new VaultTransitKeyProvider(ADDR, TOKEN, KEY_NAME, new Map([[2, CIPHERTEXT_V2]]));
}

function vaultOkResponse(plaintextBase64: string): Response {
  return new Response(JSON.stringify({ data: { plaintext: plaintextBase64 } }), {
    status: 200,
  });
}

describe("VaultTransitKeyProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns null for a version with no wrapped DEK, without calling Vault", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await makeProvider().unwrapDek(99)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs the ciphertext to Transit decrypt with X-Vault-Token and returns the DEK", async () => {
    const dek = randomBytes(32);
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(`${ADDR}/v1/transit/decrypt/${KEY_NAME}`);
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["X-Vault-Token"]).toBe(TOKEN);
      expect(JSON.parse(init.body as string)).toEqual({ ciphertext: CIPHERTEXT_V2 });
      return vaultOkResponse(dek.toString("base64"));
    });
    vi.stubGlobal("fetch", fetchSpy);
    expect(await makeProvider().unwrapDek(2)).toEqual(dek);
  });

  it("caches: a second unwrap of the same version does not call Vault again", async () => {
    const dek = randomBytes(32);
    const fetchSpy = vi.fn(async () => vaultOkResponse(dek.toString("base64")));
    vi.stubGlobal("fetch", fetchSpy);
    const provider = makeProvider();
    const first = await provider.unwrapDek(2);
    const second = await provider.unwrapDek(2);
    expect(first).toEqual(dek);
    expect(second).toEqual(dek);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws on a non-2xx Vault response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("permission denied", { status: 403 })),
    );
    await expect(makeProvider().unwrapDek(2)).rejects.toThrow(
      /Vault Transit decrypt returned 403/,
    );
  });

  it("throws when the response carries no plaintext", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200 })),
    );
    await expect(makeProvider().unwrapDek(2)).rejects.toThrow(/no plaintext/);
  });

  it("honors a non-default transit mount path in the URL", async () => {
    const dek = randomBytes(32);
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toContain("/v1/kms/decrypt/");
      return vaultOkResponse(dek.toString("base64"));
    });
    vi.stubGlobal("fetch", fetchSpy);
    const provider = new VaultTransitKeyProvider(
      ADDR,
      TOKEN,
      KEY_NAME,
      new Map([[2, CIPHERTEXT_V2]]),
      "kms",
    );
    expect(await provider.unwrapDek(2)).toEqual(dek);
  });
});
