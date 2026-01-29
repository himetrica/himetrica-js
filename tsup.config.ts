import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["react", "react-dom"],
  },
  {
    entry: ["src/react/index.ts"],
    outDir: "dist/react",
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    external: ["react", "react-dom"],
  },
]);
