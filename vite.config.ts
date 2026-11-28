import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  build: { target: "es2020", chunkSizeWarningLimit: 1500 },
  // `npm run dev`: the API runs on :8787 and Vite proxies to it.
  // xfwd forwards x-forwarded-host so the server's sameOrigin check matches the Vite origin.
  server: { proxy: { "/api": { target: "http://127.0.0.1:8787", xfwd: true } } },
});
