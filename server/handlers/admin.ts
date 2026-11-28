import type { Ctx } from "../lib/ctx";
import { files } from "../lib/storage";
import { adminCookie, clearAdminCookie, hashPassword, isAdmin } from "../lib/auth";
import { db } from "../lib/db";
import { adminOtpMail, deliveryTestMail } from "../lib/emails";
import { binary, fail, json, sameOrigin, UUID_RE } from "../lib/http";
import { newSlug, validateSlug } from "../lib/links";
import { cleanFields } from "../lib/watermark-text";
import { layoutHtml, sendMail } from "../lib/mail";
import { checkMailDns } from "../lib/mailcheck";
import { getActiveNda, ndaHash } from "../lib/nda";
import { checkOtp, issueOtp } from "../lib/otp";
import { ensureSignedPdf, sendNdaEmail } from "../lib/nda-sign";
import { overLimit, record } from "../lib/ratelimit";
import { envAdminEmails, getAllAdminEmails, getBranding, getExtraAdminEmails, getWebhooks, postWebhook, saveBranding, saveExtraAdminEmails, saveWebhooks } from "../lib/settings";
import {
  deleteLink, deleteVisitor, deleteVisits, documentStats, documentVisits, exportPageViews, exportVisits, linkDetail, ndaAcceptances, overview, recentVisits, visitDetail, visitorDetail, visitorsList,
} from "../lib/stats";
import { migrate } from "../lib/migrate";

// Serverless platforms start handlers independently; make sure the schema exists first (no-op when already current).
await migrate();


const MAX_BODY = 4_400_000; // Functions buffered payload limit is ~4.5 MB for binary

const normEmail = (s: unknown) => String(s ?? "").trim().toLowerCase();

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function readBinary(req: Request): Promise<ArrayBuffer | null> {
  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX_BODY) return null;
  return buf;
}

/* ---------------- auth ---------------- */

async function handleAuth(req: Request, ctx: Ctx, action: string): Promise<Response> {
  if (action === "me") return json({ admin: isAdmin(req) });

  if (action === "logout" && req.method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": clearAdminCookie() });
  }

  if (action === "request" && req.method === "POST") {
    const email = normEmail((await readJson(req)).email);
    // Same response whether or not the email matches, so the endpoint doesn't reveal who the admin is.
    const admins = await getAllAdminEmails();
    const isAdminEmail = !!email && admins.includes(email);
    const r = await issueOtp(email, "admin", ctx.ip ?? "unknown", isAdminEmail);
    if (!r.ok) {
      return fail(429, r.reason === "wait" ? "Please wait a moment before requesting another code." : "Too many requests. Please try again later.");
    }
    if (isAdminEmail) await sendMail({ to: email, ...adminOtpMail(r.code) });
    return json({ ok: true });
  }

  if (action === "verify" && req.method === "POST") {
    const ip = ctx.ip ?? "unknown";
    if (await overLimit("admin-verify", ip, 30, 3600)) return fail(429, "Too many attempts. Please try again later.");
    await record("admin-verify", ip);
    const body = await readJson(req);
    const email = normEmail(body.email);
    if (!(await checkOtp(email, "admin", String(body.code ?? "").trim()))) {
      return fail(401, "The code is invalid or has expired. Please request a new one.");
    }
    return json({ ok: true }, 200, { "set-cookie": adminCookie() });
  }

  return fail(404, "Not found");
}

/* ---------------- documents ---------------- */

async function listDocuments(): Promise<Response> {
  const rows = await db.sql`
    select d.id, d.title, d.note, d.archived_at, d.created_at,
      lv.id as version_id, lv.version_label, lv.page_count,
      (select count(*)::int from links l where l.document_id = d.id) as link_count,
      (select count(*)::int from visits v join links l on l.id = v.link_id where l.document_id = d.id) as visit_count,
      (select max(v.started_at) from visits v join links l on l.id = v.link_id where l.document_id = d.id) as last_visit_at
    from documents d
    left join lateral (
      select id, version_label, page_count from document_versions
      where document_id = d.id and status = 'ready' order by created_at desc limit 1
    ) lv on true
    order by d.archived_at is not null, d.created_at desc`;
  return json({ documents: rows });
}

async function getDocument(id: string): Promise<Response> {
  const [doc] = await db.sql`select id, title, note, archived_at, created_at from documents where id = ${id}`;
  if (!doc) return fail(404, "Document not found");
  const versions = await db.sql`
    select id, version_label, page_count, created_at from document_versions
    where document_id = ${id} and status = 'ready' order by created_at desc`;
  return json({ document: doc, versions });
}

async function createDocument(req: Request): Promise<Response> {
  const body = await readJson(req);
  const title = String(body.title ?? "").trim().slice(0, 200);
  const note = String(body.note ?? "").trim().slice(0, 2000) || null;
  if (!title) return fail(400, "Please enter a title");
  const [doc] = await db.sql`insert into documents (title, note) values (${title}, ${note}) returning id`;
  return json({ id: doc.id }, 201);
}

async function createVersion(req: Request, docId: string): Promise<Response> {
  const body = await readJson(req);
  const label = String(body.version_label ?? "").trim().slice(0, 60);
  const pageCount = Number(body.page_count);
  if (!label) return fail(400, "Please enter a version name");
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 500) return fail(400, "Invalid page count");
  const [doc] = await db.sql<{ archived_at: string | null }>`select archived_at from documents where id = ${docId}`;
  if (!doc) return fail(404, "Document not found");
  if (doc.archived_at) return fail(400, "The document is archived");
  const [v] = await db.sql<{ id: string }>`
    insert into document_versions (document_id, version_label, page_count, pdf_blob_key)
    values (${docId}, ${label}, ${pageCount}, '') returning id`;
  await db.sql`update document_versions set pdf_blob_key = ${`pdf/${v.id}.pdf`} where id = ${v.id}`;
  return json({ id: v.id }, 201);
}

async function uploadingVersion(vid: string) {
  const [v] = await db.sql<{ id: string; page_count: number; status: string }>`
    select id, page_count, status from document_versions where id = ${vid}`;
  return v ?? null;
}

async function handleVersion(req: Request, vid: string, rest: string[]): Promise<Response> {
  const v = await uploadingVersion(vid);
  if (!v) return fail(404, "Version not found");
  const store = files();
  const [kind, arg] = rest;
  const m = req.method;

  // PDF upload in chunks (the PDF can exceed the per-request limit)
  if (kind === "pdf" && arg === "complete" && m === "POST") {
    if (v.status !== "uploading") return fail(409, "This version is already complete");
    const parts = Number((await readJson(req)).parts);
    if (!Number.isInteger(parts) || parts < 1 || parts > 100) return fail(400, "Invalid parameters");
    const chunks: Buffer[] = [];
    for (let i = 0; i < parts; i++) {
      const c = await store.get(`upload/${vid}/${i}`, { type: "arrayBuffer" });
      if (!c) return fail(400, "Missing upload chunk");
      chunks.push(Buffer.from(c));
    }
    const pdf = Buffer.concat(chunks);
    if (pdf.subarray(0, 4).toString() !== "%PDF") return fail(400, "Not a valid PDF file");
    await store.set(`pdf/${vid}.pdf`, pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer);
    await Promise.all(Array.from({ length: parts }, (_, i) => store.delete(`upload/${vid}/${i}`)));
    return json({ ok: true });
  }

  if (kind === "pdf" && m === "PUT") {
    if (v.status !== "uploading") return fail(409, "This version is already complete");
    const idx = Number(arg);
    if (!Number.isInteger(idx) || idx < 0 || idx > 99) return fail(400, "Invalid chunk number");
    const buf = await readBinary(req);
    if (!buf) return fail(413, "Chunk is empty or too large");
    await store.set(`upload/${vid}/${idx}`, buf);
    return json({ ok: true });
  }

  if ((kind === "pages" || kind === "thumbs") && m === "PUT") {
    if (v.status !== "uploading") return fail(409, "This version is already complete");
    const n = Number(arg);
    if (!Number.isInteger(n) || n < 1 || n > v.page_count) return fail(400, "Invalid page number");
    const buf = await readBinary(req);
    if (!buf) return fail(413, "Image is empty or too large");
    await store.set(`${kind}/${vid}/${n}.webp`, buf);
    return json({ ok: true });
  }

  if ((kind === "pages" || kind === "thumbs") && m === "GET") {
    const n = Number(arg);
    if (!Number.isInteger(n) || n < 1) return fail(400, "Invalid page number");
    const img = await store.get(`${kind}/${vid}/${n}.webp`, { type: "arrayBuffer" });
    if (!img) return fail(404, "Not found");
    return binary(img, "image/webp", "private, max-age=3600");
  }

  if (kind === "finalize" && m === "POST") {
    if (v.status === "ready") return json({ ok: true });
    const { blobs } = await store.list({ prefix: `pages/${vid}/` });
    const { blobs: thumbs } = await store.list({ prefix: `thumbs/${vid}/` });
    const pdf = await store.exists(`pdf/${vid}.pdf`);
    if (!pdf) return fail(400, "The original PDF has not been uploaded yet");
    if (blobs.length !== v.page_count || thumbs.length !== v.page_count) {
      return fail(400, "Page images are incomplete");
    }
    await db.sql`update document_versions set status = 'ready' where id = ${vid}`;
    return json({ ok: true });
  }

  return fail(404, "Not found");
}

/* ---------------- links ---------------- */

const LINK_COLS = `l.id, l.document_id, l.pinned_version_id, l.slug, l.name, l.enabled, l.expires_at,
  l.require_email, l.require_otp, l.block_personal_email, l.allowed_domains, l.require_nda,
  (l.password_hash is not null) as has_password, l.allow_download, l.watermark, l.watermark_fields, l.watermark_text, l.notify_on_open, l.created_at`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const rawRows = async (q: string, params: unknown[]) => (await db.sql.unsafe(q, params)) as unknown as Row[];

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

function parseDomains(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const list = [...new Set(v.map((x) => String(x).trim().toLowerCase().replace(/^@/, "")).filter(Boolean))];
  return list.length ? list.slice(0, 50) : null;
}

async function listLinks(docId: string): Promise<Response> {
  const rows = await rawRows(
    `select ${LINK_COLS},
       (select count(distinct v.visitor_id)::int from visits v where v.link_id = l.id) as visitor_count,
       (select count(*)::int from visits v where v.link_id = l.id) as visit_count,
       (select max(v.started_at) from visits v where v.link_id = l.id) as last_visit_at
     from links l where l.document_id = $1 order by l.created_at desc`,
    [docId],
  );
  return json({ links: rows });
}

async function createLink(req: Request, docId: string): Promise<Response> {
  const b = await readJson(req);
  const name = String(b.name ?? "").trim().slice(0, 120);
  if (!name) return fail(400, "Please enter a link name");
  const [doc] = await db.sql<{ archived_at: string | null }>`select archived_at from documents where id = ${docId}`;
  if (!doc) return fail(404, "Document not found");
  if (doc.archived_at) return fail(400, "The document is archived");

  const requireEmail = bool(b.require_email, true);
  const pinned = typeof b.pinned_version_id === "string" && UUID_RE.test(b.pinned_version_id) ? b.pinned_version_id : null;
  if (pinned) {
    const [v] = await db.sql`select 1 as ok from document_versions where id = ${pinned} and document_id = ${docId} and status = 'ready'`;
    if (!v) return fail(400, "The selected version does not exist");
  }
  const expires = b.expires_at ? new Date(String(b.expires_at)) : null;
  if (expires && Number.isNaN(expires.getTime())) return fail(400, "Invalid expiry date");
  const password = typeof b.password === "string" && b.password ? hashPassword(b.password) : null;
  const wmFields = b.watermark_fields === undefined ? ["email", "date"] : cleanFields(b.watermark_fields);
  const wmText = String(b.watermark_text ?? "").trim().slice(0, 40) || null;

  const custom = typeof b.slug === "string" ? b.slug.trim() : "";
  if (custom) {
    const bad = validateSlug(custom);
    if (bad) return fail(400, bad);
    const [dup] = await db.sql`select 1 as ok from links where lower(slug) = lower(${custom})`;
    if (dup) return fail(409, "This link address is already taken. Please choose another.");
  }

  for (let i = 0; i < 5; i++) {
    const [row] = await db.sql<{ id: string; slug: string }>`
      insert into links (document_id, pinned_version_id, slug, name, enabled, expires_at, require_email, require_otp,
                         block_personal_email, allowed_domains, require_nda, password_hash, allow_download, watermark, notify_on_open,
                         watermark_fields, watermark_text)
      values (${docId}, ${pinned}, ${custom || newSlug()}, ${name}, ${bool(b.enabled, true)}, ${expires?.toISOString() ?? null},
              ${requireEmail}, ${requireEmail && bool(b.require_otp, true)},
              ${requireEmail && bool(b.block_personal_email, true)}, ${parseDomains(b.allowed_domains)},
              ${requireEmail && bool(b.require_nda, true)}, ${password}, ${bool(b.allow_download, false)},
              ${bool(b.watermark, true)}, ${bool(b.notify_on_open, true)}, ${wmFields}, ${wmText})
      on conflict do nothing returning id, slug`;
    if (row) return json(row, 201);
    if (custom) return fail(409, "This link address is already taken. Please choose another.");
  }
  return fail(500, "Could not create the link. Please try again.");
}

async function updateLink(req: Request, linkId: string): Promise<Response> {
  const [cur] = await rawRows(`select ${LINK_COLS}, l.password_hash from links l where l.id = $1`, [linkId]);
  if (!cur) return fail(404, "Link not found");
  const b = await readJson(req);
  const requireEmail = bool(b.require_email, cur.require_email);
  const name = b.name === undefined ? cur.name : String(b.name).trim().slice(0, 120);
  if (!name) return fail(400, "Please enter a link name");
  const expires = b.expires_at === undefined ? cur.expires_at : b.expires_at ? new Date(String(b.expires_at)) : null;
  if (expires && Number.isNaN(new Date(expires).getTime())) return fail(400, "Invalid expiry date");
  let pinned = cur.pinned_version_id as string | null;
  if (b.pinned_version_id !== undefined) {
    pinned = typeof b.pinned_version_id === "string" && UUID_RE.test(b.pinned_version_id) ? b.pinned_version_id : null;
    if (pinned) {
      const [v] = await db.sql`select 1 as ok from document_versions where id = ${pinned} and document_id = ${cur.document_id} and status = 'ready'`;
      if (!v) return fail(400, "The selected version does not exist");
    }
  }
  let passwordHash = cur.password_hash as string | null;
  if (b.clear_password === true) passwordHash = null;
  else if (typeof b.password === "string" && b.password) passwordHash = hashPassword(b.password);
  const domains = b.allowed_domains === undefined ? cur.allowed_domains : parseDomains(b.allowed_domains);
  let slug = cur.slug as string;
  const wanted = typeof b.slug === "string" ? b.slug.trim() : "";
  if (wanted && wanted !== cur.slug) {
    const bad = validateSlug(wanted);
    if (bad) return fail(400, bad);
    const [dup] = await db.sql`select 1 as ok from links where lower(slug) = lower(${wanted}) and id <> ${linkId}`;
    if (dup) return fail(409, "This link address is already taken. Please choose another.");
    slug = wanted;
  }
  const wmFields = b.watermark_fields === undefined ? (cur.watermark_fields ?? ["email", "date"]) : cleanFields(b.watermark_fields);
  const wmText = b.watermark_text === undefined ? cur.watermark_text : String(b.watermark_text).trim().slice(0, 40) || null;

  await db.sql`
    update links set name = ${name}, slug = ${slug}, watermark_fields = ${wmFields}, watermark_text = ${wmText}, pinned_version_id = ${pinned},
      enabled = ${bool(b.enabled, cur.enabled)},
      expires_at = ${expires ? new Date(expires).toISOString() : null},
      require_email = ${requireEmail},
      require_otp = ${requireEmail && bool(b.require_otp, cur.require_otp)},
      block_personal_email = ${requireEmail && bool(b.block_personal_email, cur.block_personal_email)},
      allowed_domains = ${domains}, require_nda = ${requireEmail && bool(b.require_nda, cur.require_nda)},
      password_hash = ${passwordHash}, allow_download = ${bool(b.allow_download, cur.allow_download)},
      watermark = ${bool(b.watermark, cur.watermark)}, notify_on_open = ${bool(b.notify_on_open, cur.notify_on_open)}
    where id = ${linkId}`;
  return json({ ok: true });
}

/* ---------------- NDA & settings ---------------- */

async function listNda(): Promise<Response> {
  await getActiveNda();
  const rows = await db.sql`select id, label, sha256, active, created_at from nda_versions order by created_at desc`;
  return json({ versions: rows });
}

async function getNda(id: string): Promise<Response> {
  const [row] = await db.sql`select id, label, body_zh, body_en, sha256, active, created_at from nda_versions where id = ${id}`;
  return row ? json(row) : fail(404, "Not found");
}

type PgClient = { query: (q: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

async function activateNda(client: PgClient, id: string) {
  await client.query("update nda_versions set active = false where active and id <> $1", [id]);
  await client.query("update nda_versions set active = true where id = $1", [id]);
}

async function inTransaction<T>(fn: (c: PgClient) => Promise<T>): Promise<T> {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function createNda(req: Request): Promise<Response> {
  const b = await readJson(req);
  const label = String(b.label ?? "").trim().slice(0, 80);
  const zh = String(b.body_zh ?? "").trim();
  const en = String(b.body_en ?? "").trim();
  if (!label || zh.length < 50 || en.length < 50) return fail(400, "Please enter a version name and the full text in both languages");
  const id = await inTransaction(async (c) => {
    const r = await c.query(
      "insert into nda_versions (label, body_zh, body_en, sha256, pdf_blob_key, active) values ($1,$2,$3,$4,'',false) returning id",
      [label, zh, en, ndaHash(zh, en)],
    );
    const newId = String(r.rows[0].id);
    if (b.activate !== false) await activateNda(c, newId);
    return newId;
  });
  return json({ id }, 201);
}

async function setActiveNda(id: string): Promise<Response> {
  const [row] = await db.sql`select 1 as ok from nda_versions where id = ${id}`;
  if (!row) return fail(404, "Not found");
  await inTransaction((c) => activateNda(c, id));
  return json({ ok: true });
}

async function listAllLinks(): Promise<Response> {
  const rows = await db.sql`
    select l.id, l.document_id, l.room_id, l.pinned_version_id, l.slug, l.name, l.enabled, l.expires_at,
           l.require_email, l.require_otp, l.block_personal_email, l.allowed_domains, l.require_nda,
           (l.password_hash is not null) as has_password, l.allow_download, l.watermark,
           l.watermark_fields, l.watermark_text, l.notify_on_open, l.created_at,
           coalesce(r.title, d.title) as doc_title,
           case when l.room_id is not null then (r.archived_at is not null) else (d.archived_at is not null) end as doc_archived,
           count(distinct v.visitor_id)::int as visitor_count,
           count(v.id)::int as visit_count,
           max(v.started_at) as last_visit_at
    from links l
    join documents d on d.id = l.document_id
    left join data_rooms r on r.id = l.room_id
    left join visits v on v.link_id = l.id
    group by l.id, d.title, d.archived_at, r.title, r.archived_at
    order by l.created_at desc`;
  return json({ links: rows });
}

/* ---------------- data rooms ---------------- */

async function listRooms(): Promise<Response> {
  const rows = await db.sql`
    select r.id, r.title, r.description, r.archived_at, r.created_at,
           (select count(*)::int from data_room_items i join documents d on d.id = i.document_id where i.room_id = r.id and d.archived_at is null) as doc_count,
           (select count(*)::int from links l where l.room_id = r.id) as link_count,
           (select count(v.id)::int from links l join visits v on v.link_id = l.id where l.room_id = r.id) as visit_count
    from data_rooms r
    order by r.archived_at is not null, r.created_at desc`;
  return json({ rooms: rows });
}

async function getRoom(id: string): Promise<Response> {
  const [room] = await db.sql`select id, title, description, archived_at, created_at from data_rooms where id = ${id}`;
  if (!room) return fail(404, "Data room not found");
  const items = await db.sql`
    select i.id, i.document_id, i.section, i.sort_order, d.title, d.archived_at,
           dv.id as version_id, dv.version_label, dv.page_count
    from data_room_items i
    join documents d on d.id = i.document_id
    left join lateral (
      select id, version_label, page_count from document_versions
      where document_id = d.id and status = 'ready' order by created_at desc limit 1
    ) dv on true
    where i.room_id = ${id}
    order by i.sort_order, i.created_at`;
  const links = await db.sql`
    select l.id, l.document_id, l.room_id, l.pinned_version_id, l.slug, l.name, l.enabled, l.expires_at,
           l.require_email, l.require_otp, l.block_personal_email, l.allowed_domains, l.require_nda,
           (l.password_hash is not null) as has_password, l.allow_download, l.watermark,
           l.watermark_fields, l.watermark_text, l.notify_on_open, l.created_at,
           count(distinct v.visitor_id)::int as visitor_count,
           count(v.id)::int as visit_count,
           max(v.started_at) as last_visit_at
    from links l left join visits v on v.link_id = l.id
    where l.room_id = ${id}
    group by l.id
    order by l.created_at desc`;
  return json({ room, items, links });
}

async function createRoom(req: Request): Promise<Response> {
  const b = await readJson(req);
  const title = String(b.title ?? "").trim().slice(0, 160);
  if (!title) return fail(400, "Please enter a data room title");
  const description = String(b.description ?? "").trim().slice(0, 1000) || null;
  const rawItems = Array.isArray(b.items) ? b.items : [];
  const id = await inTransaction(async (c) => {
    const r = await c.query("insert into data_rooms (title, description) values ($1, $2) returning id", [title, description]);
    const roomId = String(r.rows[0].id);
    let idx = 0;
    for (const it of rawItems.slice(0, 50)) {
      if (!it || typeof it !== "object") continue;
      const o = it as Record<string, unknown>;
      const docId = String(o.document_id ?? "");
      if (!UUID_RE.test(docId)) continue;
      const section = String(o.section ?? "").trim().slice(0, 80) || null;
      await c.query(
        "insert into data_room_items (room_id, document_id, section, sort_order) values ($1, $2, $3, $4) on conflict (room_id, document_id) do nothing",
        [roomId, docId, section, idx++],
      );
    }
    return roomId;
  });
  return json({ id }, 201);
}

async function updateRoom(req: Request, id: string): Promise<Response> {
  const [cur] = await db.sql`select id, title, description from data_rooms where id = ${id}`;
  if (!cur) return fail(404, "Data room not found");
  const b = await readJson(req);
  const title = b.title === undefined ? cur.title : String(b.title ?? "").trim().slice(0, 160);
  if (!title) return fail(400, "Please enter a data room title");
  const description = b.description === undefined ? cur.description : String(b.description ?? "").trim().slice(0, 1000) || null;
  await inTransaction(async (c) => {
    await c.query("update data_rooms set title = $1, description = $2 where id = $3", [title, description, id]);
    if (Array.isArray(b.items)) {
      await c.query("delete from data_room_items where room_id = $1", [id]);
      let idx = 0;
      for (const it of b.items.slice(0, 50)) {
        if (!it || typeof it !== "object") continue;
        const o = it as Record<string, unknown>;
        const docId = String(o.document_id ?? "");
        if (!UUID_RE.test(docId)) continue;
        const section = String(o.section ?? "").trim().slice(0, 80) || null;
        await c.query(
          "insert into data_room_items (room_id, document_id, section, sort_order) values ($1, $2, $3, $4) on conflict (room_id, document_id) do nothing",
          [id, docId, section, idx++],
        );
      }
    }
  });
  return json({ ok: true });
}

async function createRoomLink(req: Request, roomId: string): Promise<Response> {
  const [room] = await db.sql<{ archived_at: string | null }>`select archived_at from data_rooms where id = ${roomId}`;
  if (!room) return fail(404, "Data room not found");
  if (room.archived_at) return fail(400, "This data room is archived");
  const [first] = await db.sql<{ document_id: string }>`
    select i.document_id from data_room_items i join documents d on d.id = i.document_id
    where i.room_id = ${roomId} and d.archived_at is null order by i.sort_order, i.created_at limit 1`;
  if (!first) return fail(400, "Add at least one document to the data room before creating a link");

  const b = await readJson(req);
  const name = String(b.name ?? "").trim().slice(0, 120);
  if (!name) return fail(400, "Please enter a link name");
  const requireEmail = bool(b.require_email, true);
  const expires = b.expires_at ? new Date(String(b.expires_at)) : null;
  if (expires && Number.isNaN(expires.getTime())) return fail(400, "Invalid expiry date");
  const password = typeof b.password === "string" && b.password ? hashPassword(b.password) : null;
  const wmFields = b.watermark_fields === undefined ? ["email", "date"] : cleanFields(b.watermark_fields);
  const wmText = String(b.watermark_text ?? "").trim().slice(0, 40) || null;
  const custom = typeof b.slug === "string" ? b.slug.trim() : "";
  if (custom) {
    const bad = validateSlug(custom);
    if (bad) return fail(400, bad);
    const [dup] = await db.sql`select 1 as ok from links where lower(slug) = lower(${custom})`;
    if (dup) return fail(409, "This link address is already taken. Please choose another.");
  }
  for (let i = 0; i < 5; i++) {
    const [row] = await db.sql<{ id: string; slug: string }>`
      insert into links (document_id, room_id, slug, name, enabled, expires_at, require_email, require_otp,
                         block_personal_email, allowed_domains, require_nda, password_hash, allow_download, watermark, notify_on_open,
                         watermark_fields, watermark_text)
      values (${first.document_id}, ${roomId}, ${custom || newSlug()}, ${name}, ${bool(b.enabled, true)}, ${expires?.toISOString() ?? null},
              ${requireEmail}, ${requireEmail && bool(b.require_otp, true)},
              ${requireEmail && bool(b.block_personal_email, true)}, ${parseDomains(b.allowed_domains)},
              ${requireEmail && bool(b.require_nda, true)}, ${password}, ${bool(b.allow_download, false)},
              ${bool(b.watermark, true)}, ${bool(b.notify_on_open, true)}, ${wmFields}, ${wmText})
      on conflict do nothing returning id, slug`;
    if (row) return json(row, 201);
    if (custom) return fail(409, "This link address is already taken. Please choose another.");
  }
  return fail(500, "Could not create the link. Please try again.");
}

async function createBulkLinks(req: Request, docId: string): Promise<Response> {
  const [doc] = await db.sql<{ archived_at: string | null }>`select archived_at from documents where id = ${docId}`;
  if (!doc) return fail(404, "Document not found");
  if (doc.archived_at) return fail(400, "This document is archived; you cannot create new links for it");
  const b = await readJson(req);
  const rawNames = Array.isArray(b.names) ? b.names : [];
  const names = [...new Set(rawNames.map((n) => String(n ?? "").trim().slice(0, 120)).filter(Boolean))].slice(0, 50);
  if (!names.length) return fail(400, "Please enter at least one link name");

  const requireEmail = bool(b.require_email, true);
  const expires = b.expires_at ? new Date(String(b.expires_at)) : null;
  if (expires && Number.isNaN(expires.getTime())) return fail(400, "Invalid expiry date");
  const wmFields = b.watermark_fields === undefined ? ["email", "date"] : cleanFields(b.watermark_fields);
  const wmText = String(b.watermark_text ?? "").trim().slice(0, 40) || null;
  const created: { id: string; name: string; slug: string }[] = [];

  for (const name of names) {
    for (let i = 0; i < 5; i++) {
      const [row] = await db.sql<{ id: string; slug: string }>`
        insert into links (document_id, slug, name, enabled, expires_at, require_email, require_otp,
                           block_personal_email, allowed_domains, require_nda, allow_download, watermark, notify_on_open,
                           watermark_fields, watermark_text)
        values (${docId}, ${newSlug()}, ${name}, true, ${expires?.toISOString() ?? null},
                ${requireEmail}, ${requireEmail && bool(b.require_otp, true)},
                ${requireEmail && bool(b.block_personal_email, true)}, ${parseDomains(b.allowed_domains)},
                ${requireEmail && bool(b.require_nda, true)}, ${bool(b.allow_download, false)},
                ${bool(b.watermark, true)}, ${bool(b.notify_on_open, true)}, ${wmFields}, ${wmText})
        on conflict do nothing returning id, slug`;
      if (row) { created.push({ id: row.id, name, slug: row.slug }); break; }
    }
  }
  return json({ links: created }, 201);
}

async function getSettings(): Promise<Response> {
  const [row] = await db.sql<{ value: string[] }>`select value from settings where key = 'personal_email_domains'`;
  return json({
    personal_email_domains: row?.value ?? [],
    branding: await getBranding(),
    webhooks: await getWebhooks(),
    primary_admins: envAdminEmails(),
    extra_admins: await getExtraAdminEmails(),
  });
}

async function putPersonalDomains(req: Request): Promise<Response> {
  const list = parseDomains((await readJson(req)).domains) ?? [];
  await db.sql`
    insert into settings (key, value) values ('personal_email_domains', ${JSON.stringify(list)}::jsonb)
    on conflict (key) do update set value = excluded.value`;
  return json({ ok: true });
}

/* ---------------- router ---------------- */

export default async (req: Request, ctx: Ctx): Promise<Response> => {
  try {
    if (!sameOrigin(req)) return fail(403, "Forbidden");
    const path = new URL(req.url).pathname.replace(/^\/api\/admin\/?/, "").split("/").filter(Boolean);
    const [root, a, b, ...rest] = path;
    const m = req.method;

    if (root === "auth") return await handleAuth(req, ctx, a ?? "");
    if (!isAdmin(req)) return fail(401, "Not signed in");

    const url = new URL(req.url);
    if (m === "GET") {
      if (root === "dashboard") return await recentVisits();
      if (root === "overview") return await overview();
      if (root === "visitors") return a && UUID_RE.test(a) ? await visitorDetail(a) : await visitorsList();
      if (root === "visits" && a && UUID_RE.test(a)) return await visitDetail(a);
      if (root === "links" && !a) return await listAllLinks();
      if (root === "links" && a && UUID_RE.test(a) && !b) return await linkDetail(a);
      if (root === "nda-acceptances" && !a) return await ndaAcceptances();
      if (root === "nda-acceptances" && a && UUID_RE.test(a) && b === "pdf") {
        const signed = await ensureSignedPdf(a);
        if (!signed) return fail(404, "Signing record not found");
        return new Response(signed.pdf.buffer.slice(signed.pdf.byteOffset, signed.pdf.byteOffset + signed.pdf.byteLength) as ArrayBuffer, {
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `inline; filename="${signed.filename}"`,
            "cache-control": "private, no-store",
            "x-robots-tag": "noindex, nofollow",
          },
        });
      }
      if (root === "export") {
        const doc = url.searchParams.get("document");
        const docId = doc && UUID_RE.test(doc) ? doc : null;
        const lk = url.searchParams.get("link");
        const linkFilter = lk && UUID_RE.test(lk) ? lk : null;
        if (a === "visits.csv") return await exportVisits(docId, linkFilter);
        if (a === "page-views.csv") return await exportPageViews(docId, linkFilter);
      }
      if (root === "documents" && a && UUID_RE.test(a) && b === "visits") {
        const lk = url.searchParams.get("link");
        return await documentVisits(a, lk && UUID_RE.test(lk) ? lk : null);
      }
      if (root === "documents" && a && UUID_RE.test(a) && b === "stats") {
        const ver = url.searchParams.get("version");
        const lk = url.searchParams.get("link");
        return await documentStats(a, ver && UUID_RE.test(ver) ? ver : null, lk && UUID_RE.test(lk) ? lk : null);
      }
    }

    if (root === "rooms") {
      if (!a) {
        if (m === "GET") return await listRooms();
        if (m === "POST") return await createRoom(req);
      } else if (UUID_RE.test(a)) {
        if (!b && m === "GET") return await getRoom(a);
        if (!b && m === "PATCH") return await updateRoom(req, a);
        if (b === "links" && m === "POST") return await createRoomLink(req, a);
        if (b === "archive" && m === "POST") {
          await db.sql`update data_rooms set archived_at = now() where id = ${a} and archived_at is null`;
          return json({ ok: true });
        }
      }
    }
    if (root === "documents") {
      if (!a) {
        if (m === "GET") return await listDocuments();
        if (m === "POST") return await createDocument(req);
      } else if (UUID_RE.test(a)) {
        if (!b && m === "GET") return await getDocument(a);
        if (!b && m === "PATCH") {
          const body = await readJson(req);
          const title = String(body.title ?? "").trim().slice(0, 200);
          if (!title) return fail(400, "The title cannot be empty");
          const note = String(body.note ?? "").trim().slice(0, 2000) || null;
          await db.sql`update documents set title = ${title}, note = ${note} where id = ${a}`;
          return json({ ok: true });
        }
        if (b === "versions" && m === "POST") return await createVersion(req, a);
        if (b === "links" && !rest[0] && m === "GET") return await listLinks(a);
        if (b === "links" && !rest[0] && m === "POST") return await createLink(req, a);
        if (b === "links" && rest[0] === "bulk" && m === "POST") return await createBulkLinks(req, a);
        if (b === "archive" && m === "POST") {
          await db.sql`update documents set archived_at = now() where id = ${a} and archived_at is null`;
          return json({ ok: true });
        }
      }
    }
    if (root === "nda-acceptances" && a && UUID_RE.test(a) && b === "resend" && m === "POST") {
      const sent = await sendNdaEmail(a);
      return sent ? json({ ok: true }) : fail(404, "Signing record not found");
    }
    if (root === "visits" && a === "delete" && m === "POST") return await deleteVisits((await readJson(req)).ids);
    if (root === "links" && a && UUID_RE.test(a) && m === "DELETE") return await deleteLink(a);
    if (root === "visitors" && a && UUID_RE.test(a) && m === "PATCH") {
      const b = await readJson(req);
      const STATUSES = ["new", "contacted", "meeting", "declined"];
      const [cur] = await db.sql<{ status: string | null; note: string | null }>`select status, note from visitors where id = ${a}`;
      if (!cur) return fail(404, "Visitor not found");
      let status = cur.status;
      if (b.status !== undefined) {
        if (typeof b.status !== "string" || !STATUSES.includes(b.status)) return fail(400, "Invalid status");
        status = b.status === "new" ? null : b.status;
      }
      const note = b.note === undefined ? cur.note : String(b.note).trim().slice(0, 500) || null;
      await db.sql`update visitors set status = ${status}, note = ${note} where id = ${a}`;
      return json({ ok: true });
    }
    if (root === "visitors" && a && UUID_RE.test(a) && m === "DELETE") {
      const { response, pdfKeys } = await deleteVisitor(a);
      await Promise.all(pdfKeys.map((k) => files().delete(k).catch(() => {})));
      return response;
    }
    if (root === "links" && a && UUID_RE.test(a) && m === "PATCH") return await updateLink(req, a);
    if (root === "nda") {
      if (!a) {
        if (m === "GET") return await listNda();
        if (m === "POST") return await createNda(req);
      } else if (UUID_RE.test(a)) {
        if (!b && m === "GET") return await getNda(a);
        if (b === "activate" && m === "POST") return await setActiveNda(a);
      }
    }
    if (root === "mail-check" && m === "GET") {
      const from = (process.env.SMTP_USER ?? "").split("@")[1] ?? "";
      if (!from) return fail(400, "SMTP_USER is not configured");
      const sel = new URL(req.url).searchParams.get("selector")?.trim() ?? "";
      const selector = /^[A-Za-z0-9._-]{1,63}$/.test(sel) ? sel : null;
      return json(await checkMailDns(from, selector, `docs.${from}`));
    }
    if (root === "mail-test" && m === "POST") {
      // Admin-only tool for the go-live delivery test (qq, 163, Outlook, Gmail, a corporate mailbox).
      if (await overLimit("mail-test", "admin", 15, 3600)) return fail(429, "Too many test emails. Please try again in an hour.");
      const list = [...new Set(((await readJson(req)).to as unknown[] | undefined ?? []).map((x) => normEmail(x)).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))].slice(0, 5);
      if (!list.length) return fail(400, "Please enter at least one valid email address");
      const results: { to: string; ok: boolean; error?: string }[] = [];
      for (const to of list) {
        await record("mail-test", "admin");
        try {
          await sendMail({ to, ...deliveryTestMail() });
          results.push({ to, ok: true });
        } catch (e) {
          results.push({ to, ok: false, error: String((e as Error).message ?? e).slice(0, 200) });
        }
      }
      return json({ results });
    }
    if (root === "settings") {
      if (!a && m === "GET") return await getSettings();
      if (a === "personal-domains" && m === "PUT") return await putPersonalDomains(req);
      if (a === "branding" && m === "PUT") return json({ branding: await saveBranding(await readJson(req)) });
      if (a === "webhooks" && !b && m === "PUT") return json({ webhooks: await saveWebhooks((await readJson(req)).webhooks) });
      if (a === "webhooks" && b === "test" && m === "POST") {
        const body = await readJson(req);
        const url = String(body.url ?? "").trim();
        if (!/^https?:\/\//i.test(url)) return fail(400, "Please enter a valid webhook URL");
        const kind = body.kind === "slack" || body.kind === "lark" ? body.kind : "generic";
        const res = await postWebhook({ id: "test", name: "Test", url, kind, enabled: true }, {
          event: "test",
          title: "SendFolio test notification",
          body: "Your webhook is connected and ready to deliver real-time reading alerts.",
          admin_url: `${(process.env.SITE_URL ?? "").replace(/\/$/, "")}/admin`,
        });
        return json(res, res.ok ? 200 : 502);
      }
      if (a === "admins" && m === "PUT") return json({ extra_admins: await saveExtraAdminEmails((await readJson(req)).emails) });
    }
    if (root === "versions" && a && UUID_RE.test(a)) {
      return await handleVersion(req, a, [b ?? "", ...rest]);
    }
    return fail(404, "Not found");
  } catch (e) {
    console.error("admin api error", e);
    return fail(500, "Server error");
  }
};

