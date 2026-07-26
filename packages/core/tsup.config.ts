import { defineConfig } from "tsup";

// ESM-only build. The three entry points back the package's subpath exports:
//   "."       -> src/index.ts
//   "./http"  -> src/http/index.ts
//   "./mcp"   -> src/mcp/index.ts
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "http/index": "src/http/index.ts",
    "mcp/index": "src/mcp/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
});
