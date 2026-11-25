// Creates .env from .env.example with a fresh SESSION_SECRET and the values you give it.
//   npm run init                                   asks a few questions
//   npm run init -- --admin-email you@x.com --site-url https://docs.x.com --app-name "Acme Docs" --yes
// Safe to re-run: an existing .env is never overwritten unless you pass --force.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import readline from "node:readline/promises";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (name) => args.includes(`--${name}`);

if (fs.existsSync(".env") && !has("force")) {
  console.log(".env already exists, leaving it alone. Run `npm run doctor` to check it, or pass --force to recreate it.");
  process.exit(0);
}

const interactive = process.stdin.isTTY && !has("yes");
const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
const ask = async (label, fallback) => (rl ? (await rl.question(`${label}${fallback ? ` [${fallback}]` : ""}: `)).trim() || fallback : fallback);

const adminEmail = flag("admin-email") ?? (await ask("Admin email (the only address that can sign in to /admin)", ""));
const siteUrl = (flag("site-url") ?? (await ask("Public site URL", "http://localhost:8787"))).replace(/\/$/, "");
const appName = flag("app-name") ?? (await ask("App name", "SendFolio"));
const locale = flag("locale") ?? (await ask("Default language (en or zh)", "en"));
const timezone = flag("timezone") ?? (await ask("Time zone (e.g. UTC, America/New_York, Asia/Shanghai)", "UTC"));
rl?.close();

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail ?? "")) {
  console.error("A valid --admin-email is required (it is the only address that can sign in to the admin area).");
  process.exit(1);
}

let env = fs.readFileSync(".env.example", "utf8");
const set = (key, value) => { env = env.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`); };
set("SESSION_SECRET", randomBytes(36).toString("base64url"));
set("ADMIN_EMAIL", adminEmail);
set("SITE_URL", siteUrl);
set("APP_NAME", appName);
set("DEFAULT_LOCALE", locale === "zh" ? "zh" : "en");
set("TIMEZONE", timezone);
if (siteUrl.startsWith("https://")) set("HSTS", "true");
fs.writeFileSync(".env", env, { mode: 0o600 });
console.log("Created .env.");
console.log("Next: npm run build && npm start   (then open " + siteUrl + "/admin)");
console.log("Email is not configured yet: login codes will be printed in the server log. See .env.example for SMTP settings.");
