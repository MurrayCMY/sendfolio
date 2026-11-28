// Checks that this installation is ready and says exactly what to fix.
//   npm run doctor              human-readable
//   npm run doctor -- --json    machine-readable (for AI agents and CI); exit code 1 if anything blocking failed
import fs from "node:fs";
import net from "node:net";

try { process.loadEnvFile?.(".env"); } catch { /* no .env */ }
const json = process.argv.includes("--json");
const results = [];
const add = (id, level, message, fix) => results.push({ id, level, message, ...(fix ? { fix } : {}) });
// level: ok | warn | fail   (fail blocks a working deployment)

const major = Number(process.versions.node.split(".")[0]);
major >= 22 ? add("node", "ok", `Node.js ${process.versions.node}`) : add("node", "fail", `Node.js ${process.versions.node} is too old`, "Install Node.js 22 or newer (https://nodejs.org).");

fs.existsSync(".env") || Object.keys(process.env).includes("SESSION_SECRET")
  ? add("env", "ok", "Configuration found")
  : add("env", "fail", "No .env file and no SESSION_SECRET in the environment", "Run: npm run init");

const secret = process.env.SESSION_SECRET ?? "";
secret.length >= 32 ? add("secret", "ok", "SESSION_SECRET is set") : add("secret", "fail", "SESSION_SECRET is missing or shorter than 32 characters", "Run: npm run init (or set a random 32+ character value)");

const admin = process.env.ADMIN_EMAIL ?? "";
/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin) ? add("admin", "ok", `Admin email: ${admin}`) : add("admin", "fail", "ADMIN_EMAIL is missing or not an email address", "Set ADMIN_EMAIL to the address that should be able to sign in to /admin.");

const site = process.env.SITE_URL ?? "";
if (!site) add("site", "fail", "SITE_URL is not set", "Set SITE_URL to the public address of your site, e.g. https://docs.example.com");
else if (/localhost|127\.0\.0\.1/.test(site)) add("site", "warn", `SITE_URL is ${site}`, "Fine for trying it out. Set the real public address before sharing links with anyone.");
else add("site", "ok", `Public address: ${site}`);
if (site.startsWith("http://") && !/localhost|127\.0\.0\.1/.test(site)) add("https", "warn", "SITE_URL is plain http", "Serve the site over HTTPS (see docs/deploy-docker.md, which includes automatic HTTPS) and set HSTS=true.");

// database
const dbUrl = process.env.DATABASE_URL || process.env.NETLIFY_DB_URL;
if (dbUrl) {
  try {
    const pg = (await import("pg")).default;
    const client = new pg.Client({ connectionString: dbUrl, connectionTimeoutMillis: 8000 });
    await client.connect();
    await client.query("select 1");
    await client.end();
    add("database", "ok", "PostgreSQL connection works");
  } catch (e) {
    add("database", "fail", `Cannot connect to PostgreSQL: ${e.message}`, "Check DATABASE_URL (user, password, host, port, database name) and that the database accepts connections from this machine.");
  }
} else {
  add("database", "ok", "No DATABASE_URL: using the embedded PGlite database in ./data/pglite");
  add("database-prod", "warn", "Embedded PGlite is single-process and meant for trying things out and small sites", "For production set DATABASE_URL to a PostgreSQL database (docker compose does this for you).");
}

// storage
if (process.env.STORAGE_DRIVER === "s3" || process.env.S3_BUCKET) {
  const ok = !!(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
  add("storage", ok ? "ok" : "fail", ok ? `S3-compatible storage configured (bucket: ${process.env.S3_BUCKET})` : "S3 storage is missing credentials", "Set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_ENDPOINT.");
} else try {
  const dir = process.env.STORAGE_DIR ?? "./data/files";
  fs.mkdirSync(dir, { recursive: true });
  const probe = `${dir}/.doctor-${process.pid}`;
  fs.writeFileSync(probe, "ok");
  fs.rmSync(probe);
  add("storage", "ok", `File storage is writable (${dir})`);
} catch (e) {
  add("storage", process.env.STORAGE_DRIVER === "netlify" ? "ok" : "fail", `File storage is not writable: ${e.message}`, "Make STORAGE_DIR a writable directory (in Docker: mount a volume there).");
}

// mail
if (process.env.SMTP_HOST && process.env.SMTP_PASS) {
  try {
    const nodemailer = (await import("nodemailer")).default;
    const port = Number(process.env.SMTP_PORT ?? 465);
    const tx = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }, connectionTimeout: 8000, greetingTimeout: 8000 });
    await tx.verify();
    add("smtp", "ok", `SMTP login works (${process.env.SMTP_HOST})`);
    if (!process.env.MAIL_FROM) add("mail-from", "warn", "MAIL_FROM is not set; the SMTP user will be the sender", "Set MAIL_FROM to an address your SMTP provider allows, e.g. SendFolio <docs@yourdomain.com>.");
  } catch (e) {
    add("smtp", "fail", `SMTP check failed: ${e.message}`, "Check SMTP_HOST, SMTP_PORT (465 = TLS, 587 = STARTTLS), SMTP_USER and SMTP_PASS. Gmail needs an app password.");
  }
} else {
  add("smtp", "warn", "SMTP is not configured: emails (including admin login codes) are printed in the server log, not sent", "Set SMTP_HOST, SMTP_USER and SMTP_PASS (examples in .env.example) before inviting real visitors.");
}

// build output
fs.existsSync("dist/index.html") ? add("build-web", "ok", "Front end is built") : add("build-web", "fail", "Front end is not built (dist/index.html missing)", "Run: npm run build");
fs.existsSync("dist-server/index.mjs") ? add("build-server", "ok", "Server is built") : add("build-server", "fail", "Server is not built (dist-server/index.mjs missing)", "Run: npm run build");

// port
const port = Number(process.env.PORT ?? 8787);
await new Promise((resolve) => {
  const s = net.createServer();
  s.once("error", () => { add("port", "warn", `Port ${port} is already in use`, "Stop the other program, set PORT to a free port, or ignore this if SendFolio is already running there."); resolve(); });
  s.once("listening", () => s.close(() => { add("port", "ok", `Port ${port} is free`); resolve(); }));
  s.listen(port, "127.0.0.1");
});

const failed = results.filter((r) => r.level === "fail").length;
if (json) {
  console.log(JSON.stringify({ ok: failed === 0, results }, null, 2));
} else {
  const icon = { ok: "✔", warn: "!", fail: "✖" };
  for (const r of results) {
    console.log(`${icon[r.level]} ${r.message}`);
    if (r.fix && r.level !== "ok") console.log(`    → ${r.fix}`);
  }
  console.log(failed === 0 ? "\nReady." : `\n${failed} problem${failed > 1 ? "s" : ""} to fix before this will work.`);
}
process.exit(failed === 0 ? 0 : 1);
