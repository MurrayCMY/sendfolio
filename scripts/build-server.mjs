// Bundles the self-hosted server (server/index.ts) into dist-server/index.mjs, plus the demo seeder (demo.mjs).
// Dependencies stay external (they are installed from package.json at runtime), so native/WASM assets keep working.
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["server/index.ts", "server/demo.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  outdir: "dist-server",
  entryNames: "[name]",
  outExtension: { ".js": ".mjs" },
  logLevel: "info",
  sourcemap: true,
});
