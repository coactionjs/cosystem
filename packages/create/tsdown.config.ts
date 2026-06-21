import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  platform: "node",
  sourcemap: true,
  target: "es2022",
  treeshake: true,
});
