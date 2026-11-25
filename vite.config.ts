import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  build: { target: "es2020", chunkSizeWarningLimit: 1500 },
  // `npm run dev`: the API runs on :8787 and Vite proxies to it.
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
});
