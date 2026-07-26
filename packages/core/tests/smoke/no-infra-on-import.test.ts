import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createEngine } from "../../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const corePkg = JSON.parse(
  readFileSync(resolve(here, "../../package.json"), "utf8"),
) as Record<string, Record<string, unknown> | undefined>;

// Packages the OSS core must never import or depend on. The whole point of
// the carve-out: the engine runs with zero host infrastructure by default.
const FORBIDDEN = ["pg", "ioredis", "bullmq", "minio", "kafkajs"];

describe("no infrastructure on import (the architectural gate)", () => {
  it("createEngine() runs on null ports and does not throw", () => {
    expect(() => createEngine()).not.toThrow();
  });

  it("@pith/core declares no infra in dependencies / peerDependencies / optionalDependencies", () => {
    const declared: Record<string, unknown> = {
      ...(corePkg["dependencies"] ?? {}),
      ...(corePkg["peerDependencies"] ?? {}),
      ...(corePkg["optionalDependencies"] ?? {}),
    };
    for (const pkg of FORBIDDEN) {
      expect(declared).not.toHaveProperty(pkg);
    }
  });

  it("no forbidden infra package is resolvable from the package (not installed)", async () => {
    for (const pkg of FORBIDDEN) {
      // A module that isn't installed fails to resolve — the core must not
      // be able to load any infra even transitively at import time.
      await expect(async () => import(pkg)).rejects.toThrow();
    }
  });
});
