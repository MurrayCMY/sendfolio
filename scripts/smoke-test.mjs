// End-to-end smoke test against a RUNNING server. It signs in as admin, uploads a tiny document, creates a link,
// reads it as a visitor (email code + NDA), checks tracking and the admin views, then cleans up after itself.
//
//   node dist-server/index.mjs > server.log 2>&1 &
//   node scripts/smoke-test.mjs --log server.log [--base http://localhost:8787]
//
// The server prints emails to its log when SMTP is not configured; the test reads the login codes from there.
import fs from "node:fs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const BASE = opt("base", "http://localhost:8787");
const LOG = opt("log", "server.log");
try { process.loadEnvFile?.(".env"); } catch { /* optional */ }
const ADMIN = process.env.ADMIN_EMAIL;
if (!ADMIN) { console.error("ADMIN_EMAIL must be set (in .env or the environment)."); process.exit(2); }

let failed = 0;
const ok = (name) => console.log(`  ok  ${name}`);
const bad = (name, extra) => { failed++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ""}`); };
const check = (cond, name, extra) => (cond ? ok(name) : bad(name, extra));

class Jar {
  cookies = new Map();
  async fetch(path, init = {}) {
    const headers = { ...(init.headers ?? {}), cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "), origin: BASE };
    const res = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
    for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); this.cookies.set(kv.slice(0, i), kv.slice(i + 1)); }
    return res;
  }
  async json(path, body, method = body === undefined ? "GET" : "POST") {
    const res = await this.fetch(path, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    return { status: res.status, data };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Waits for a "[mail:not-sent] to=<email> subject=<...>" line and returns the 6-digit code in it. */
async function codeFor(email, after) {
  for (let i = 0; i < 40; i++) {
    const text = fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8") : "";
    const lines = text.slice(after).split("\n").filter((l) => l.includes(`to=${email}`));
    for (const l of lines.reverse()) { const m = l.match(/\b(\d{6})\b/); if (m) return m[1]; }
    await sleep(250);
  }
  throw new Error(`no code email for ${email} found in ${LOG} (is SMTP unset, so mails are logged?)`);
}
const logSize = () => (fs.existsSync(LOG) ? fs.statSync(LOG).size : 0);

console.log(`Smoke test against ${BASE}`);

// 1. public endpoints
{
  const r = await fetch(`${BASE}/healthz`);
  check(r.ok, "GET /healthz");
  const c = await (await fetch(`${BASE}/api/v/_/config`)).json();
  check(typeof c.app_name === "string" && c.app_name.length > 0, "public config has app_name", JSON.stringify(c));
  const html = await (await fetch(`${BASE}/admin`)).text();
  check(html.includes('<div id="app">'), "admin page serves the SPA");
  const nf = await fetch(`${BASE}/api/admin/overview`);
  check(nf.status === 401, "admin API requires login", `status ${nf.status}`);
}

// 2. admin sign-in
const admin = new Jar();
{
  const mark = logSize();
  const req = await admin.json("/api/admin/auth/request", { email: ADMIN });
  check(req.status === 200, "admin requests a code", JSON.stringify(req));
  const code = await codeFor(ADMIN, mark);
  const ver = await admin.json("/api/admin/auth/verify", { email: ADMIN, code });
  check(ver.status === 200, "admin signs in with the code", JSON.stringify(ver));
  const me = await admin.json("/api/admin/auth/me");
  check(me.data?.admin === true, "session is recognised");
}

// 3. document + version + link
const stamp = Date.now().toString(36);
let docId, linkId;
const slug = `smoke-${stamp}`;
{
  const doc = await admin.json("/api/admin/documents", { title: `Smoke test ${stamp}`, note: "created by scripts/smoke-test.mjs" });
  docId = doc.data?.id;
  check(!!docId, "create document", JSON.stringify(doc));
  const ver = await admin.json(`/api/admin/documents/${docId}/versions`, { version_label: "v1", page_count: 2 });
  const vid = ver.data?.id;
  check(!!vid, "create version", JSON.stringify(ver));
  const bin = (path, bytes, type) => admin.fetch(`/api/admin/${path}`, { method: "PUT", headers: { "content-type": type }, body: bytes });
  const pdf = new TextEncoder().encode("%PDF-1.4\n% smoke test placeholder\n");
  check((await bin(`versions/${vid}/pdf/0`, pdf, "application/octet-stream")).ok, "upload PDF chunk");
  check((await admin.json(`/api/admin/versions/${vid}/pdf/complete`, { parts: 1 })).status === 200, "complete PDF upload");
  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 0, 0, 0, 0, 0x2f, 0, 0, 0, 0, 0]);
  for (const kind of ["pages", "thumbs"]) for (const n of [1, 2]) check((await bin(`versions/${vid}/${kind}/${n}`, webp, "image/webp")).ok, `upload ${kind} ${n}`);
  check((await admin.json(`/api/admin/versions/${vid}/finalize`, {})).status === 200, "finalize version");

  const link = await admin.json(`/api/admin/documents/${docId}/links`, { name: "Smoke link", slug, require_otp: true, require_nda: true, block_personal_email: false, watermark_fields: ["name", "email", "datetime"], watermark_text: "SMOKE" });
  linkId = link.data?.id;
  check(!!linkId && link.data.slug === slug, "create link with a custom address", JSON.stringify(link));
  const dup = await admin.json(`/api/admin/documents/${docId}/links`, { name: "dup", slug: slug.toUpperCase() });
  check(dup.status === 409, "custom address is unique (case-insensitive)", `status ${dup.status}`);
}

// 4. visitor flow
const visitor = new Jar();
const VISITOR = `smoke.${stamp}@example.com`;
let visitId;
{
  const info = await visitor.json(`/api/v/${slug}/info`);
  check(info.data?.status === "ok" && info.data.step === "identity", "visitor sees the identity step", JSON.stringify(info.data));
  const mark = logSize();
  const start = await visitor.json(`/api/v/${slug}/start`, { name: "Smoke Tester", email: VISITOR, lang: "en" });
  check(start.status === 200 && start.data?.step === "code", "visitor requests a code", JSON.stringify(start));
  const code = await codeFor(VISITOR, mark);
  const ver = await visitor.json(`/api/v/${slug}/verify`, { pending: start.data.pending, code });
  check(ver.status === 200, "visitor verifies the code", JSON.stringify(ver));
  const nda = await visitor.json(`/api/v/${slug}/nda`);
  check(typeof nda.data?.body_en === "string" && nda.data.body_en.length > 200, "NDA text is served", JSON.stringify(nda.data)?.slice(0, 120));
  const early = await visitor.json(`/api/v/${slug}/open`, {});
  check(early.status === 403, "document is locked until the NDA is accepted", `status ${early.status}`);
  const acc = await visitor.json(`/api/v/${slug}/accept`, { agree: true, lang: "en" });
  check(acc.status === 200, "visitor accepts the NDA", JSON.stringify(acc));
  const open = await visitor.json(`/api/v/${slug}/open`, {});
  visitId = open.data?.visit_id;
  check(open.status === 200 && !!visitId, "visitor opens the document", JSON.stringify(open));
  check(typeof open.data?.watermark === "string" && open.data.watermark.includes("SMOKE") && open.data.watermark.includes(VISITOR), "watermark text is built on the server", String(open.data?.watermark));
  const img = await visitor.fetch(`/api/v/${slug}/pages/${visitId}/1`);
  check(img.ok && img.headers.get("content-type") === "image/webp", "page image is served");
  const hb = await visitor.json(`/api/v/${slug}/heartbeat`, { visit_id: visitId, page: 2, active: true, ms: 5000 });
  check(hb.status === 200, "heartbeat is recorded", JSON.stringify(hb));
  const dl = await visitor.json(`/api/v/${slug}/open`, {});
  check(dl.status === 200, "re-opening reuses the session");
}

// 5. admin views see the visit
{
  const ov = await admin.json("/api/admin/overview");
  check(ov.status === 200 && ov.data?.kpi?.visits_7d >= 1, "overview counts the visit", JSON.stringify(ov.data?.kpi));
  const vs = await admin.json("/api/admin/visitors");
  const me = vs.data?.visitors?.find((v) => v.email === VISITOR);
  check(!!me && me.visits >= 1, "visitor list includes the visitor", JSON.stringify(me));
  check(me?.docs?.some((d) => d.startsWith("Smoke test")), "visitor list shows the document read");
  const set = await admin.json(`/api/admin/visitors/${me?.id}`, { status: "contacted", note: "smoke" }, "PATCH");
  check(set.status === 200, "follow-up status and note can be saved", JSON.stringify(set));
  const acc = await admin.json("/api/admin/nda-acceptances");
  check(acc.data?.acceptances?.some((a) => a.email === VISITOR), "NDA signing record exists");
  const csv = await admin.fetch(`/api/admin/export/visits.csv?doc=${docId}`);
  check(csv.ok && (await csv.text()).includes("Visit ID"), "CSV export works");
}

// 6. clean up everything the test created
{
  const vs = await admin.json("/api/admin/visitors");
  const me = vs.data?.visitors?.find((v) => v.email === VISITOR);
  if (me) {
    const del = await admin.json(`/api/admin/visitors/${me.id}`, undefined, "DELETE");
    check(del.status === 200, "delete the test visitor and their data", JSON.stringify(del));
  }
  check((await admin.fetch(`/api/admin/links/${linkId}`, { method: "DELETE" })).ok, "delete the test link");
  const gone = await visitor.json(`/api/v/${slug}/info`);
  check(gone.data?.status === "invalid", "deleted link no longer opens");
  check((await admin.json(`/api/admin/documents/${docId}/archive`, {})).status === 200, "archive the test document");
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
