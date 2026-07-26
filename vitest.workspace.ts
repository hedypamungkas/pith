import { defineWorkspace } from "vitest/config";

// Four key-free projects (smoke is the fifth — the "no infra on import" gate).
// All run on `npm test`; each is independently runnable via `--project <name>`.
// Zero env vars, zero containers, zero API keys by design (no dotenv setup).
const common = {
  environment: "node" as const,
  testTimeout: 20_000,
};

export default defineWorkspace([
  {
    extends: undefined,
    test: {
      ...common,
      name: "unit",
      include: ["packages/**/tests/unit/**/*.test.ts"],
    },
  },
  {
    test: {
      ...common,
      name: "smoke",
      include: ["packages/**/tests/smoke/**/*.test.ts"],
    },
  },
  {
    test: {
      ...common,
      name: "integration-real",
      include: ["packages/**/tests/integration-real/**/*.test.ts"],
    },
  },
  {
    test: {
      ...common,
      name: "integration-nock",
      include: ["packages/**/tests/integration-nock/**/*.test.ts"],
    },
  },
  {
    test: {
      ...common,
      name: "accuracy",
      include: ["packages/**/tests/accuracy/**/*.test.ts"],
    },
  },
]);
