import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createEngine } from "../../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const corePkg = JSON.parse(
  readFileSync(resolve(here, "../../package.json"), "utf8"),
) as Record<string, Record<string, unknown> | undefined>;

// Packages the OSS core must never import or depend on. The whole point of
// the carve-out: the engine runs with zero host infrastructure by default.
const FORBIDDEN = ["pg", "ioredis", "bullmq", "minio", "kafkajs"];

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(full, acc);
    else if (/\.[cm]?ts$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function bareSpecifier(spec: string): string {
  // Scoped ("@scope/name") keeps two segments; bare keeps one.
  return spec.startsWith("@")
    ? spec.split("/").slice(0, 2).join("/")
    : (spec.split("/")[0] ?? spec);
}

describe("no infrastructure on import (the architectural gate)", () => {
  it("createEngine() runs on null ports and does not throw", () => {
    expect(() => createEngine()).not.toThrow();
  });

  it("@use-pith/core declares no infra in dependencies / peerDependencies / optionalDependencies", () => {
    const declared: Record<string, unknown> = {
      ...(corePkg["dependencies"] ?? {}),
      ...(corePkg["peerDependencies"] ?? {}),
      ...(corePkg["optionalDependencies"] ?? {}),
    };
    for (const pkg of FORBIDDEN) {
      expect(declared).not.toHaveProperty(pkg);
    }
  });

  it("core source never statically imports/requires forbidden infra", () => {
    // A sibling adapter package (@use-pith/adapters-pg) legitimately depends on
    // `pg`, and npm hoists it to the root node_modules — so "is `pg` resolvable
    // at runtime" no longer expresses the invariant (it resolves from anywhere
    // now). The real invariant is that CORE's own source never imports it.
    // Scan every TS file under src for a static import, dynamic import, or
    // re-export of a forbidden module specifier.
    const srcDir = resolve(here, "../../src");
    const specifiers = /\b(?:from|import|require)\b\s*\(?\s*["'`]([^"'`]+)["'`]/g;
    const violations: string[] = [];
    for (const file of listSourceFiles(srcDir)) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "") // strip block comments
        .replace(/\/\/[^\n]*/g, ""); // strip line comments
      let m: RegExpExecArray | null;
      while ((m = specifiers.exec(code)) !== null) {
        const bare = bareSpecifier(m[1]!);
        if (FORBIDDEN.includes(bare)) {
          violations.push(`${file}: ${m[1]}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
