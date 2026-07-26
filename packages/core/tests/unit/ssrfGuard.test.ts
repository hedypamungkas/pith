import { describe, expect, it, vi } from "vitest";

vi.mock("node:dns", () => ({
  promises: {
    lookup: vi.fn(),
  },
}));

// Imported after the mock so ssrfGuard picks up the mocked dns module.
import { promises as dns } from "node:dns";
import {
  assertAllowedScheme,
  assertPublicHost,
  BlockedHostError,
} from "../../src/fetch/ssrfGuard.js";

const mockLookup = dns.lookup as unknown as ReturnType<typeof vi.fn>;

describe("assertAllowedScheme", () => {
  it("allows http and https", () => {
    expect(() => assertAllowedScheme(new URL("http://example.com"))).not.toThrow();
    expect(() => assertAllowedScheme(new URL("https://example.com"))).not.toThrow();
  });

  it("rejects other schemes", () => {
    expect(() => assertAllowedScheme(new URL("file:///etc/passwd"))).toThrow(
      BlockedHostError,
    );
    expect(() => assertAllowedScheme(new URL("ftp://example.com"))).toThrow(
      BlockedHostError,
    );
  });
});

describe("assertPublicHost", () => {
  it("blocks IPv4 loopback", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    await expect(assertPublicHost("localhost")).rejects.toBeInstanceOf(
      BlockedHostError,
    );
  });

  it("blocks private 10.x addresses", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "10.1.2.3", family: 4 }]);
    await expect(assertPublicHost("internal.example")).rejects.toBeInstanceOf(
      BlockedHostError,
    );
  });

  it("blocks the link-local / cloud metadata range", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    await expect(assertPublicHost("metadata.internal")).rejects.toBeInstanceOf(
      BlockedHostError,
    );
  });

  it("blocks IPv6 loopback and unique-local addresses", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::1", family: 6 }]);
    await expect(assertPublicHost("v6-loopback")).rejects.toBeInstanceOf(
      BlockedHostError,
    );

    mockLookup.mockResolvedValueOnce([{ address: "fd00::1", family: 6 }]);
    await expect(assertPublicHost("v6-ula")).rejects.toBeInstanceOf(
      BlockedHostError,
    );
  });

  it("blocks IPv4-mapped IPv6 addresses in a private range", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::ffff:10.0.0.5", family: 6 }]);
    await expect(assertPublicHost("mapped-private")).rejects.toBeInstanceOf(
      BlockedHostError,
    );
  });

  it("allows a public IPv4 address", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    await expect(assertPublicHost("example.com")).resolves.toBeUndefined();
  });

  it("wraps DNS resolution failures in BlockedHostError", async () => {
    mockLookup.mockRejectedValueOnce(new Error("ENOTFOUND"));
    await expect(assertPublicHost("no-such-host.invalid")).rejects.toBeInstanceOf(
      BlockedHostError,
    );
  });

  it("blocks multicast and reserved ranges", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "224.0.0.1", family: 4 }]);
    await expect(assertPublicHost("multicast")).rejects.toBeInstanceOf(
      BlockedHostError,
    );
    mockLookup.mockResolvedValueOnce([{ address: "240.0.0.1", family: 4 }]);
    await expect(assertPublicHost("reserved")).rejects.toBeInstanceOf(
      BlockedHostError,
    );
  });
});
