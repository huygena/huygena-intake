import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    splitting: false,
    target: "es2022",
    outDir: "dist",
    platform: "neutral",
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    sourcemap: true,
    splitting: false,
    target: "node20",
    outDir: "dist",
    platform: "node",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
