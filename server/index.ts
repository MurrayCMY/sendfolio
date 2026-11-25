/**
 * Self-hosted entry point: serves the built front end (dist/), the two API handlers, runs database migrations
 * on start and the background job every 10 minutes. Used by `npm start` and by the Docker image.
 * (On Netlify the same handlers are mounted by netlify/functions/*.mts instead.)
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";

// Load .env before anything reads the environment (variables already set win).
try { process.loadEnvFile?.(".env"); } catch { /* no .env file: fine, use real environment variables */ }

const PORT = Number(process.env.PORT ?? 8787);
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY ?? "");
const MAX_BODY = 12 * 1024 * 1024; // page images are uploaded one request each; this is generous
const DIST = path.resolve(process.env.DIST_DIR ?? "dist");

const { migrate } = await import("./lib/migrate");
const { db } = await import("./lib/db");
const { default: adminHandler } = await import("./handlers/admin");
const { default: visitorHandler } = await import("./handlers/visitor");
const { default: scheduled } = await import("./handlers/scheduled");
const { config } = await import("./lib/config");

const applied = await migrate();
if (applied.length) console.log(`[db] applied ${applied.length} migration(s): ${applied.join(", ")}`);
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error("SESSION_SECRET is missing or shorter than 32 characters. Run `npm run init` or set it in .env.");
  process.exit(1);
}
if (!config.adminEmail()) console.warn("[config] ADMIN_EMAIL is not set: nobody will be able to sign in to /admin.");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp",
  ".ico": "image/x-icon", ".json": "application/json; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8", ".map": "application/json",
};
const SECURITY_HEADERS: Record<string, string> = {
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
if (/^(1|true|yes)$/i.test(process.env.HSTS ?? "")) SECURITY_HEADERS["strict-transport-security"] = "max-age=31536000; includeSubDomains";

function clientIp(req: http.IncomingMessage): string | undefined {
  if (TRUST_PROXY) {
    const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
    if (fwd) return fwd;
    const real = String(req.headers["x-real-ip"] ?? "").trim();
    if (real) return real;
  }
  return req.socket.remoteAddress?.replace(/^::ffff:/, "");
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
function geoHint(req: http.IncomingMessage) {
  if (!TRUST_PROXY) return undefined;
  // Cloudflare (and a few other CDNs) pass the visitor's country; anything else simply has no geo.
  const code = String(req.headers["cf-ipcountry"] ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") return undefined;
  let name: string | undefined;
  try { name = regionNames.of(code); } catch { /* unknown code */ }
  const city = req.headers["cf-ipcity"] ? String(req.headers["cf-ipcity"]) : undefined;
  return { city, country: { name: name ?? code } };
}

async function readBody(req: http.IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) return null;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

async function sendResponse(res: http.ServerResponse, response: Response, head: boolean) {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((v, k) => { if (k !== "set-cookie") headers[k] = v; });
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(response.status, headers);
  if (head || !response.body) return void res.end();
  Readable.fromWeb(response.body as never).pipe(res);
}

async function runApi(handler: (req: Request, ctx: import("./lib/ctx").Ctx) => Promise<Response>, req: http.IncomingMessage, res: http.ServerResponse) {
  const body = ["GET", "HEAD"].includes(req.method ?? "GET") ? null : await readBody(req);
  if (body === null && !["GET", "HEAD"].includes(req.method ?? "GET")) {
    res.writeHead(413, { "content-type": "application/json" });
    return void res.end(JSON.stringify({ error: "Request too large" }));
  }
  const host = (TRUST_PROXY && String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim()) || req.headers.host || "localhost";
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  const request = new Request(`http://${host}${req.url}`, { method: req.method, headers, body: body && body.length ? new Uint8Array(body) : undefined });
  const ctx = {
    ip: clientIp(req),
    geo: geoHint(req),
    waitUntil: (p: Promise<unknown>) => { Promise.resolve(p).catch((e) => console.error("background task failed:", e)); },
  };
  try {
    await sendResponse(res, await handler(request, ctx), req.method === "HEAD");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Server error" }));
  }
}

const isSpaRoute = (p: string) => p === "/admin" || p.startsWith("/admin/") || p.startsWith("/v/") || /^\/[A-Za-z0-9_-]+\/?$/.test(p);

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  let file = path.join(DIST, path.normalize(pathname));
  if (!file.startsWith(DIST)) { res.writeHead(403); return void res.end(); }
  let isIndex = false;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (pathname !== "/" && !isSpaRoute(pathname)) { res.writeHead(404, { "content-type": "text/plain" }); return void res.end("Not found"); }
    file = path.join(DIST, "index.html");
    isIndex = true;
    if (!fs.existsSync(file)) { res.writeHead(503, { "content-type": "text/plain" }); return void res.end("Front end not built. Run `npm run build`."); }
  }
  const type = MIME[path.extname(file)] ?? "application/octet-stream";
  const cache = isIndex || file.endsWith("index.html") ? "no-cache" : pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600";
  res.writeHead(200, { "content-type": type, "cache-control": cache, ...SECURITY_HEADERS });
  if (req.method === "HEAD") return void res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  if (url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    return void res.end(JSON.stringify({ ok: true, db: db.kind }));
  }
  if (url.startsWith("/api/admin/") || url === "/api/admin") return void runApi(adminHandler, req, res);
  if (url.startsWith("/api/v/")) return void runApi(visitorHandler, req, res);
  if (url.startsWith("/api/")) { res.writeHead(404, { "content-type": "application/json" }); return void res.end(JSON.stringify({ error: "Not found" })); }
  serveStatic(req, res);
});
server.listen(PORT, () => console.log(`${config.appName} is running on http://localhost:${PORT}  (admin: /admin)`));

// Background job (retry NDA mails, reading summaries). Never overlaps itself.
let running = false;
const tick = async () => {
  if (running) return;
  running = true;
  try { await scheduled(); } catch (e) { console.error("scheduled job failed:", e); } finally { running = false; }
};
setTimeout(tick, 20_000).unref();
setInterval(tick, 10 * 60_000).unref();

const shutdown = async () => {
  server.close();
  try { await db.close(); } catch { /* already closed */ }
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
