import { promises as dns } from "node:dns";
import { isIPv4, isIPv6 } from "node:net";

export class BlockedHostError extends Error {
  constructor(host: string, reason: string) {
    super(`Refusing to fetch ${host}: ${reason}`);
    this.name = "BlockedHostError";
  }
}

function ipv4ToInt(ip: string): number {
  return ip
    .split(".")
    .reduce((acc, octet) => (acc << 8) + Number(octet), 0);
}

function inIpv4Range(ip: string, base: string, prefixBits: number): boolean {
  const mask = prefixBits === 0 ? 0 : (0xffffffff << (32 - prefixBits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

// Private, loopback, link-local, and other non-public IPv4 ranges an SSRF
// attempt could target (cloud metadata endpoints live in 169.254.0.0/16).
const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local / cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

function isBlockedIpv4(ip: string): boolean {
  return BLOCKED_IPV4_RANGES.some(([base, bits]) => inIpv4Range(ip, base, bits));
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true; // loopback / unspecified
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9")) return true; // fe80::/10 (partial check)
  if (normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // fc00::/7 unique-local
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — unwrap and check the embedded address.
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1] as string);
  return false;
}

function isBlockedIp(ip: string): boolean {
  if (isIPv4(ip)) return isBlockedIpv4(ip);
  if (isIPv6(ip)) return isBlockedIpv6(ip);
  return true; // unrecognized format — fail closed
}

/**
 * Resolves `hostname` and throws BlockedHostError if any resolved address is
 * private/loopback/link-local. Call this for the initial URL and again for
 * every redirect hop — the destination can change after the first check.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (err) {
    throw new BlockedHostError(
      hostname,
      `DNS resolution failed: ${(err as Error).message}`,
    );
  }

  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new BlockedHostError(
        hostname,
        `resolves to non-public address ${address}`,
      );
    }
  }
}

export function assertAllowedScheme(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedHostError(url.hostname, `disallowed scheme ${url.protocol}`);
  }
}
