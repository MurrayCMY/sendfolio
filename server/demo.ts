/**
 * Fills the database with a made-up sample: two documents with rendered pages, a few links, fictional visitors and
 * reading activity, so you can look around the admin area straight away.   npm run demo
 * Everything here is invented (names, companies, example.com addresses). It only runs on an EMPTY database.
 * Needs the dev dependencies (it draws the slides with @napi-rs/canvas).
 */
try { process.loadEnvFile?.(".env"); } catch { /* optional */ }
const { createCanvas } = await import("@napi-rs/canvas");
const { PDFDocument } = await import("pdf-lib");
const { migrate } = await import("./lib/migrate");
const { db } = await import("./lib/db");
const { files } = await import("./lib/storage");
const { getActiveNda } = await import("./lib/nda");

await migrate();
const [{ n }] = await db.sql<{ n: number }>`select count(*)::int as n from documents`;
if (n > 0) {
  console.log("This database already has documents; the demo only runs on an empty one. (Delete ./data to start over.)");
  await db.close();
  process.exit(0);
}

// deterministic pseudo-random numbers, so every run produces the same sample
let seed = 42;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

interface Slide { title: string; lines: string[]; kind?: "title" | "chart" | "split" }
const SAMPLE_A: Slide[] = [
  { title: "Northwind Analytics", lines: ["Decisions, minus the spreadsheets", "Seed round · Sample deck"], kind: "title" },
  { title: "The problem", lines: ["Teams drown in dashboards nobody trusts", "Analysts spend 60% of their week on data prep", "Answers arrive after the decision is made"] },
  { title: "Our solution", lines: ["Ask a question in plain language", "Get a sourced answer in seconds", "Share it with one link"], kind: "split" },
  { title: "Traction", lines: ["Monthly revenue, last 8 months"], kind: "chart" },
  { title: "Market", lines: ["Bottom-up: 40,000 mid-size companies", "Average contract $18k per year", "$720M serviceable market"] },
  { title: "Business model", lines: ["Per-seat subscription", "Usage-based add-ons", "Net revenue retention 118%"] },
  { title: "Team", lines: ["Jane Doe · CEO · ex-data platform lead", "Sam Lee · CTO · ex-search infrastructure", "Priya Patel · Head of Growth"] },
  { title: "The ask", lines: ["Raising $2.5M seed", "18 months of runway", "Hire 6 engineers, 2 in go-to-market"], kind: "title" },
];
const SAMPLE_B: Slide[] = [
  { title: "Q3 investor update", lines: ["Northwind Analytics", "Sample document"], kind: "title" },
  { title: "Highlights", lines: ["Revenue up 34% quarter over quarter", "Signed 3 enterprise pilots", "Hired a Head of Sales"] },
  { title: "Metrics", lines: ["Monthly revenue, last 8 months"], kind: "chart" },
  { title: "Risks & priorities", lines: ["Reduce onboarding time to 2 days", "Close the Series A conversation", "Ship the permissions model"], kind: "split" },
  { title: "Thank you", lines: ["Questions? Reply to this email."], kind: "title" },
];

function drawSlide(s: Slide, index: number, total: number, W = 1600, H = 900) {
  const c = createCanvas(W, H);
  const g = c.getContext("2d");
  const dark = s.kind === "title";
  const bg = g.createLinearGradient(0, 0, W, H);
  if (dark) { bg.addColorStop(0, "#1a213d"); bg.addColorStop(1, "#3949ab"); } else { bg.addColorStop(0, "#ffffff"); bg.addColorStop(1, "#f1f3fa"); }
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = dark ? "rgba(255,255,255,.08)" : "rgba(57,73,171,.07)";
  g.beginPath(); g.arc(W - 120, 140, 260, 0, Math.PI * 2); g.fill();
  g.fillStyle = dark ? "#ffffff" : "#1a213d";
  g.font = `600 ${dark ? 92 : 64}px sans-serif`;
  g.fillText(s.title, 110, dark ? 400 : 190);
  g.font = `400 ${dark ? 40 : 42}px sans-serif`;
  g.fillStyle = dark ? "rgba(255,255,255,.85)" : "#3f4658";
  if (s.kind === "chart") {
    g.fillText(s.lines[0], 110, 262);
    const base = 780, left = 150, bw = 120;
    const values = [18, 22, 27, 31, 40, 46, 55, 68];
    values.forEach((v, i) => {
      const h = v * 6.4;
      g.fillStyle = i === values.length - 1 ? "#3949ab" : "#aab3e4";
      g.fillRect(left + i * (bw + 56), base - h, bw, h);
      g.fillStyle = "#3f4658"; g.font = "400 30px sans-serif"; g.fillText(`$${v}k`, left + i * (bw + 56) + 14, base - h - 14);
    });
  } else {
    s.lines.forEach((line, i) => {
      const y = (dark ? 480 : 300) + i * 96;
      if (!dark) { g.fillStyle = "#3949ab"; g.beginPath(); g.arc(128, y - 14, 9, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = dark ? "rgba(255,255,255,.85)" : "#3f4658";
      g.font = `400 ${dark ? 40 : 42}px sans-serif`;
      g.fillText(line, dark ? 110 : 160, y);
    });
  }
  g.font = "400 26px sans-serif";
  g.fillStyle = dark ? "rgba(255,255,255,.6)" : "#80878f";
  g.fillText(`${index + 1} / ${total}`, W - 160, H - 50);
  return c;
}

async function makeDocument(title: string, note: string, slides: Slide[]) {
  const [doc] = await db.sql<{ id: string }>`insert into documents (title, note) values (${title}, ${note}) returning id`;
  const [ver] = await db.sql<{ id: string }>`
    insert into document_versions (document_id, version_label, page_count, pdf_blob_key, status)
    values (${doc.id}, 'v1', ${slides.length}, '', 'ready') returning id`;
  const pdf = await PDFDocument.create();
  for (let i = 0; i < slides.length; i++) {
    const page = drawSlide(slides[i], i, slides.length);
    const png = page.toBuffer("image/png");
    const img = await pdf.embedPng(png);
    const p = pdf.addPage([800, 450]);
    p.drawImage(img, { x: 0, y: 0, width: 800, height: 450 });
    await files().set(`pages/${ver.id}/${i + 1}.webp`, new Uint8Array(page.toBuffer("image/webp", 82)));
    const th = createCanvas(320, 180);
    th.getContext("2d").drawImage(page as never, 0, 0, 320, 180);
    await files().set(`thumbs/${ver.id}/${i + 1}.webp`, new Uint8Array(th.toBuffer("image/webp", 80)));
  }
  await files().set(`pdf/${ver.id}.pdf`, new Uint8Array(await pdf.save()));
  return { docId: doc.id, versionId: ver.id, pages: slides.length };
}

const A = await makeDocument("Northwind Analytics – Seed deck", "Sample document created by `npm run demo`.", SAMPLE_A);
const B = await makeDocument("Q3 investor update", "Sample document created by `npm run demo`.", SAMPLE_B);
const nda = await getActiveNda();

const link = async (docId: string, slug: string, name: string, extra: { enabled?: boolean; download?: boolean } = {}) =>
  (await db.sql<{ id: string }>`
    insert into links (document_id, slug, name, enabled, allow_download, require_otp, require_nda, block_personal_email, watermark_fields)
    values (${docId}, ${slug}, ${name}, ${extra.enabled ?? true}, ${extra.download ?? false}, true, true, false, ${["name", "email", "date"]})
    returning id`)[0].id;
const L1 = await link(A.docId, "acme", "Acme Ventures – Jane Doe", { download: true });
const L2 = await link(A.docId, "northstar", "Northstar Capital – Sam Lee");
const L3 = await link(A.docId, "angel-priya", "Angel – Priya Patel");
const L4 = await link(B.docId, "q3-update", "Q3 update – existing investors");
await link(A.docId, "old-link", "Retired link", { enabled: false });

const people = [
  { name: "Jane Doe", email: "jane.doe@acme-ventures.example", link: L1, doc: A, visits: 3, depth: 1, status: "contacted", note: "Asked for the cohort data; call booked for Friday." },
  { name: "Sam Lee", email: "sam@northstar.example", link: L2, doc: A, visits: 1, depth: 0.5, status: null, note: null },
  { name: "Priya Patel", email: "priya@angel.example", link: L3, doc: A, visits: 2, depth: 0.85, status: "meeting", note: "Intro meeting set for next week." },
  { name: "Alex Morgan", email: "alex.morgan@seedfund.example", link: L1, doc: A, visits: 1, depth: 0.25, status: "declined", note: "Not investing in analytics right now." },
  { name: "Taylor Reed", email: "taylor@existing.example", link: L4, doc: B, visits: 2, depth: 1, status: null, note: null },
];
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
let order = 0;
for (const p of people) {
  const [v] = await db.sql<{ id: string }>`insert into visitors (name, email, status, note, first_seen_at) values (${p.name}, ${p.email}, ${p.status}, ${p.note}, ${hoursAgo(24 * 6)}) returning id`;
  await db.sql`
    insert into nda_acceptances (visitor_id, nda_version_id, link_id, name_as_entered, email, ip, accepted_at, email_sent_at, doc_title, link_name, otp_verified, lang)
    values (${v.id}, ${nda.id}, ${p.link}, ${p.name}, ${p.email}, '203.0.113.7', ${hoursAgo(24 * 6)}, ${hoursAgo(24 * 6)}, 'sample', 'sample', true, 'en')`;
  for (let k = 0; k < p.visits; k++) {
    order++;
    const started = hoursAgo(6 + order * 9 + k * 20);
    const reach = Math.max(1, Math.round(p.doc.pages * (k === p.visits - 1 ? p.depth : Math.min(p.depth, 0.6))));
    const device = ["desktop", "desktop", "mobile"][order % 3];
    const city = ["San Francisco", "London", "Singapore", "Berlin", "New York"][order % 5];
    const country = ["United States", "United Kingdom", "Singapore", "Germany", "United States"][order % 5];
    const [visit] = await db.sql<{ id: string }>`
      insert into visits (link_id, version_id, visitor_id, started_at, last_heartbeat_at, max_page, ip, device, geo_city, geo_country, open_notified_at, summary_sent_at)
      values (${p.link}, ${p.doc.versionId}, ${v.id}, ${started}, ${started}, ${reach}, '203.0.113.7', ${device}, ${city}, ${country}, ${started}, ${started}) returning id`;
    let total = 0;
    for (let page = 1; page <= reach; page++) {
      const ms = Math.round((6 + rnd() * 40 + (page === 4 ? 40 : 0)) * 1000);
      total += ms;
      await db.sql`insert into page_views (visit_id, page, active_ms, first_viewed_at) values (${visit.id}, ${page}, ${ms}, ${started})`;
    }
    await db.sql`update visits set total_active_ms = ${total} where id = ${visit.id}`;
  }
}
console.log("Demo data created: 2 documents, 5 links, 5 visitors. Open /admin and sign in.");
console.log("Sample link: /acme   (the NDA and email code apply, so use an address you can read; codes are printed in the server log without SMTP)");
await db.close();
process.exit(0);

export {};
