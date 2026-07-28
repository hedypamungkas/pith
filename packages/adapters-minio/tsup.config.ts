import { defineConfig } from "tsup";

// ESM-only build backing the package's single subpath export:
//   "." -> src/index.ts
// Mirrors packages/{core,adapters-pg}/tsup.config.ts. The `minio` dependency
// is consumed by this package only — never by core.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
});
