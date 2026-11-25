// Development: Vite (hot reload) on :5173 proxying /api to the server on :8787, which restarts when server code changes.
// Embedded PGlite and local file storage are used unless you set DATABASE_URL / STORAGE_DIR in .env.
import { spawn } from "node:child_process";
import * as esbuild from "esbuild";

const ctx = await esbuild.context({
  entryPoints: ["server/index.ts"], bundle: true, platform: "node", format: "esm", target: "node22", packages: "external",
  outfile: "dist-server/index.mjs", sourcemap: true, logLevel: "error",
});
await ctx.watch();

const server = spawn(process.execPath, ["--watch", "--watch-path=dist-server", "dist-server/index.mjs"], {
  stdio: "inherit", env: { ...process.env, PORT: "8787", SITE_URL: process.env.SITE_URL ?? "http://localhost:5173" },
});
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", "5173", "--host", "127.0.0.1"], { stdio: "inherit" });
const stop = () => { server.kill(); vite.kill(); ctx.dispose(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (c) => { if (c) stop(); });
