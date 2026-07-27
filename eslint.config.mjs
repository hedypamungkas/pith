import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.git/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,mts}"],
    plugins: { import: importPlugin },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      // The architectural invariant: the OSS core must never import host
      // infrastructure. The hard guard is the smoke test
      // (no-infra-on-import.test.ts); these zones make a static import of any
      // adapter package fail lint too. Belt-and-suspenders.
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./packages/core/src/**/*",
              from: "./packages/**/{db,queue,storage,config,billing,gdpr,pilot,freshness}/**/*",
              message:
                "The OSS core must not import host infrastructure (db/queue/storage/config/billing/gdpr/pilot/freshness). Inject it via a CorePorts adapter instead.",
            },
            {
              target: "./packages/core/src/**/*",
              from: "./packages/adapters-*/**/*",
              message:
                "The OSS core must not import adapter packages (@use-pith/adapters-* pull pg/minio/bullmq). Inject a backend via a CorePorts adapter instead.",
            },
          ],
        },
      ],
    },
  },
  prettierConfig,
);
