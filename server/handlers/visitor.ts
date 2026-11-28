import { config, pickLocale } from "../lib/config";
import type { Ctx } from "../lib/ctx";
import { files } from "../lib/storage";
import { isAdmin, readVisitor, signToken, verifyPassword, verifyToken, visitorCookie } from "../lib/auth";
import { db } from "../lib/db";
import { visitorOtpMail } from "../lib/emails";
import { binary, fail, json, sameOrigin, UUID_RE } from "../lib/http";
import type { LinkRow } from "../lib/links";
import { linkUsable, loadLinkBySlug, personalDomains, resolveVersion } from "../lib/links";
import { sendMail } from "../lib/mail";
import { getActiveNda } from "../lib/nda";
import { checkOtp, issueOtp } from "../lib/otp";
import { sendNdaEmail } from "../lib/nda-sign";
import { watermarkPdf } from "../lib/watermark-pdf";
import { buildWatermark } from "../lib/watermark-text";
import { notifyOpen } from "../lib/notify";
import { getBranding } from "../lib/settings";
import { overLimit, record } from "../lib/ratelimit";
import { parseUserAgent } from "../lib/ua";
import { migrate } from "../lib/migrate";

// Serverless platforms start handlers independently; make sure the schema exists first (no-op when already current).
await migrate();

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

const err = (status: number, code: string, message: string) => json({ error: message, code }, status);

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function needsNda(visitorId: string): Promise<boolean> {
  const nda = await getActiveNda();
  const [row] = await db.sql`
    select 1 as ok from nda_acceptances where visitor_id = ${visitorId} and nda_version_id = ${nda.id} limit 1`;
  return !row;
}

async function upsertVisitor(email: string, name: string): Promise<string> {
  const [v] = await db.sql<{ id: string }>`
    insert into visitors (email, name) values (${email}, ${name})
    on conflict (email) do update set name = excluded.name returning id`;
  return v.id;
}

/** Issue the per-link session cookie and report which step comes next. */
async function startSession(link: LinkRow, vid: string | null, email: string | null, name: string | null) {
  const next = link.require_nda && vid && (await needsNda(vid)) ? "nda" : "read";
  return json({ step: next }, 200, { "set-cookie": visitorCookie(link.slug, { lid: link.id, vid, email, name }) });
}

const isAdminPreview = (req: Request) => new URL(req.url).searchParams.get("preview") === "1" && isAdmin(req);

async function handleInfo(req: Request, link: LinkRow): Promise<Response> {
  const isRoom = !!link.room_id;
  const ver = isRoom ? null : await resolveVersion(link);
  const docCount = isRoom
    ? (await db.sql<{ n: number }>`
        select count(*)::int as n from data_room_items i join documents d on d.id = i.document_id
        where i.room_id = ${link.room_id} and d.archived_at is null`)[0]?.n ?? 0
    : null;
  if (isAdminPreview(req)) {
    return json({
      status: "ok",
      title: link.doc_title,
      page_count: ver?.page_count ?? null,
      is_room: isRoom,
      room_description: link.room_description ?? null,
      doc_count: docCount,
      step: "read",
      preview: true,
      require_email: link.require_email,
      require_otp: link.require_otp,
      require_password: !!link.password_hash,
      require_nda: link.require_nda,
      visitor: { name: "Jane Doe (Preview)", email: config.adminEmail() || "preview@example.com" },
    });
  }
  const s = readVisitor(req, link.slug, link.id);
  const step = !s ? "identity" : link.require_nda && s.vid && (await needsNda(s.vid)) ? "nda" : "read";
  return json({
    status: "ok",
    title: link.doc_title,
    page_count: ver?.page_count ?? null,
    is_room: isRoom,
    room_description: link.room_description ?? null,
    doc_count: docCount,
    step,
    require_email: link.require_email,
    require_otp: link.require_otp,
    require_password: !!link.password_hash,
    require_nda: link.require_nda,
    visitor: s ? { name: s.name, email: s.email } : null,
  });
}

async function handleStart(req: Request, ctx: Ctx, link: LinkRow): Promise<Response> {
  const ip = ctx.ip ?? "unknown";
  if (await overLimit("start", ip, 60, 3600)) return err(429, "rate", "Too many requests. Please try again later.");
  await record("start", ip);

  const b = await readJson(req);

  if (link.password_hash) {
    const key = `${ip}:${link.id}`;
    if (await overLimit("pw", key, 10, 3600)) return err(429, "rate", "Too many attempts. Please try again later.");
    if (typeof b.password !== "string" || !verifyPassword(b.password, link.password_hash)) {
      await record("pw", key);
      return err(403, "bad_password", "Incorrect access password.");
    }
  }

  if (!link.require_email) return startSession(link, null, null, null);

  const name = String(b.name ?? "").trim().slice(0, 100);
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!name || !EMAIL_RE.test(email) || email.length > 254) return err(400, "invalid", "Please enter your name and a valid email.");

  const domain = email.split("@")[1];
  const allowed = link.allowed_domains ?? [];
  if (allowed.length && !allowed.includes(domain)) {
    return err(403, "domain_not_allowed", "This email domain is not allowed.");
  }
  if (link.block_personal_email && (await personalDomains()).includes(domain)) {
    return err(403, "personal_email", "Please use your work email.");
  }

  if (!link.require_otp) return startSession(link, await upsertVisitor(email, name), email, name);

  const issued = await issueOtp(email, "visitor", ip);
  if (!issued.ok) {
    return issued.reason === "wait"
      ? err(429, "wait", "Please wait a moment before requesting another code.")
      : err(429, "rate", "Too many codes requested. Please try again later.");
  }
  await sendMail({ to: email, ...visitorOtpMail(name, link.doc_title, issued.code, pickLocale(b.lang)) });
  const pending = signToken({ k: "pend", lid: link.id, email, name }, 15 * 60);
  return json({ step: "code", pending });
}

async function handleVerify(req: Request, ctx: Ctx, link: LinkRow): Promise<Response> {
  const ip = ctx.ip ?? "unknown";
  if (await overLimit("verify", ip, 30, 3600)) return err(429, "rate", "Too many attempts. Please try again later.");
  await record("verify", ip);
  const b = await readJson(req);
  const p = verifyToken<{ k: string; lid: string; email: string; name: string }>(String(b.pending ?? ""));
  if (!p || p.k !== "pend" || p.lid !== link.id) return err(400, "expired", "Please start over.");
  if (!(await checkOtp(p.email, "visitor", String(b.code ?? "").trim()))) {
    return err(401, "bad_code", "The code is incorrect or has expired.");
  }
  return startSession(link, await upsertVisitor(p.email, p.name), p.email, p.name);
}

async function handleNda(req: Request, link: LinkRow): Promise<Response> {
  const s = readVisitor(req, link.slug, link.id);
  if (!s?.vid) return err(401, "auth", "Please verify your identity first.");
  const n = await getActiveNda();
  return json({ id: n.id, label: n.label, sha256: n.sha256, body_zh: n.body_zh, body_en: n.body_en });
}

async function handleAccept(req: Request, ctx: Ctx, link: LinkRow): Promise<Response> {
  const s = readVisitor(req, link.slug, link.id);
  if (!s?.vid || !s.email) return err(401, "auth", "Please verify your identity first.");
  const body = await readJson(req);
  if (body.agree !== true) return err(400, "agree", "Please tick the box to agree.");
  if (await needsNda(s.vid)) {
    const n = await getActiveNda();
    const [acc] = await db.sql<{ id: string }>`
      insert into nda_acceptances (visitor_id, nda_version_id, link_id, name_as_entered, email, ip, user_agent, doc_title, link_name, otp_verified, lang)
      values (${s.vid}, ${n.id}, ${link.id}, ${s.name ?? ""}, ${s.email}, ${ctx.ip ?? null},
              ${(req.headers.get("user-agent") ?? "").slice(0, 500)}, ${link.doc_title}, ${link.name}, ${link.require_otp}, ${pickLocale(body.lang)})
      returning id`;
    // Build the signed PDF and email it after the response; the scheduled function retries if this fails.
    ctx.waitUntil(sendNdaEmail(acc.id).catch((e) => console.error("NDA email failed", acc.id, e)));
  }
  return json({ step: "read" });
}

async function resolveRoomDoc(roomId: string, docId: string) {
  if (!UUID_RE.test(docId)) return null;
  const [row] = await db.sql<{ id: string; title: string; version_id: string; version_label: string; page_count: number }>`
    select d.id, d.title, dv.id as version_id, dv.version_label, dv.page_count
    from data_room_items i
    join documents d on d.id = i.document_id and d.archived_at is null
    join lateral (
      select id, version_label, page_count from document_versions
      where document_id = d.id and status = 'ready' order by created_at desc limit 1
    ) dv on true
    where i.room_id = ${roomId} and d.id = ${docId}`;
  return row ?? null;
}

async function handleRoom(req: Request, link: LinkRow): Promise<Response> {
  if (!link.room_id) return err(404, "invalid", "Not a data room");
  if (!isAdminPreview(req)) {
    const s = readVisitor(req, link.slug, link.id);
    if (!s || (link.require_email && !s.vid)) return err(401, "auth", "Please verify your identity first.");
    if (link.require_nda && s.vid && (await needsNda(s.vid))) return err(403, "nda", "Please accept the NDA first.");
  }
  const docs = await db.sql<{ id: string; title: string; section: string | null; version_id: string; version_label: string; page_count: number }>`
    select d.id, d.title, i.section, dv.id as version_id, dv.version_label, dv.page_count
    from data_room_items i
    join documents d on d.id = i.document_id and d.archived_at is null
    join lateral (
      select id, version_label, page_count from document_versions
      where document_id = d.id and status = 'ready' order by created_at desc limit 1
    ) dv on true
    where i.room_id = ${link.room_id}
    order by i.sort_order, i.created_at`;
  return json({ title: link.room_title ?? link.doc_title, description: link.room_description ?? null, preview: isAdminPreview(req), documents: docs });
}

async function handleRoomThumb(req: Request, link: LinkRow, docId?: string): Promise<Response> {
  if (!link.room_id || !docId) return err(404, "invalid", "Not found");
  if (!isAdminPreview(req)) {
    const s = readVisitor(req, link.slug, link.id);
    if (!s || (link.require_email && !s.vid)) return err(401, "auth", "Please verify your identity first.");
    if (link.require_nda && s.vid && (await needsNda(s.vid))) return err(403, "nda", "Please accept the NDA first.");
  }
  const doc = await resolveRoomDoc(link.room_id, docId);
  if (!doc) return err(404, "invalid", "Not found");
  const img = await files().get(`thumbs/${doc.version_id}/1.webp`, { type: "arrayBuffer" });
  if (!img) return err(404, "invalid", "Not found");
  return binary(img, "image/webp");
}

async function handleOpen(req: Request, ctx: Ctx, link: LinkRow): Promise<Response> {
  const body = await readJson(req);
  const reqDocId = typeof body.document_id === "string" ? body.document_id : "";

  if (isAdminPreview(req)) {
    const roomDoc = link.room_id && reqDocId ? await resolveRoomDoc(link.room_id, reqDocId) : null;
    const version = roomDoc
      ? { id: roomDoc.version_id, version_label: roomDoc.version_label, page_count: roomDoc.page_count }
      : await resolveVersion(link);
    if (!version) return err(404, "invalid", "The file is unavailable.");
    const previewEmail = config.adminEmail() || "preview@example.com";
    return json({
      visit_id: "preview",
      preview: true,
      document_id: roomDoc?.id ?? link.document_id,
      title: roomDoc?.title ?? link.doc_title,
      version_label: version.version_label,
      page_count: version.page_count,
      name: "Jane Doe",
      email: previewEmail,
      watermark: buildWatermark(link, { name: "Jane Doe", email: previewEmail, ip: ctx.ip ?? null }, new Date()),
      allow_download: false,
    });
  }
  const s = readVisitor(req, link.slug, link.id);
  if (!s) return err(401, "auth", "Please verify your identity first.");
  if (link.require_email && !s.vid) return err(401, "auth", "Please verify your identity first.");
  if (link.require_nda && s.vid && (await needsNda(s.vid))) return err(403, "nda", "Please accept the NDA first.");
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 500);

  const roomDoc = link.room_id && reqDocId ? await resolveRoomDoc(link.room_id, reqDocId) : null;
  if (link.room_id && reqDocId && !roomDoc) return err(404, "invalid", "The file is unavailable.");
  const targetDocId = roomDoc?.id ?? link.document_id;

  // A visit continues until 15 minutes pass without a heartbeat. Reloading or reopening within that
  // window (same person, same device, same document) resumes it; anything later starts a new visit.
  const [open] = await db.sql<{ id: string; version_id: string }>`
    select v.id, v.version_id from visits v join document_versions dv on dv.id = v.version_id
    where v.link_id = ${link.id} and dv.document_id = ${targetDocId}
      and v.visitor_id is not distinct from ${s.vid}::uuid and v.user_agent = ${ua}
      and coalesce(v.last_heartbeat_at, v.started_at) > now() - interval '15 minutes'
    order by v.started_at desc limit 1`;
  let version = open
    ? (await db.sql<{ id: string; version_label: string; page_count: number }>`
        select id, version_label, page_count from document_versions where id = ${open.version_id}`)[0]
    : roomDoc
      ? { id: roomDoc.version_id, version_label: roomDoc.version_label, page_count: roomDoc.page_count }
      : await resolveVersion(link);
  if (!version) return err(404, "invalid", "The file is unavailable.");

  let visitId = open?.id;
  if (!visitId) {
    const { device, inWechat } = parseUserAgent(ua);
    const [visit] = await db.sql<{ id: string }>`
      insert into visits (link_id, version_id, visitor_id, ip, user_agent, device, in_wechat, geo_city, geo_country)
      values (${link.id}, ${version.id}, ${s.vid}, ${ctx.ip ?? null}, ${ua}, ${device}, ${inWechat},
              ${ctx.geo?.city ?? null}, ${ctx.geo?.country?.name ?? null})
      returning id`;
    visitId = visit.id;
    ctx.waitUntil(notifyOpen(visit.id));
  }
  return json({
    visit_id: visitId,
    document_id: targetDocId,
    title: roomDoc?.title ?? link.doc_title,
    version_label: version.version_label,
    page_count: version.page_count,
    name: s.name,
    email: s.email,
    watermark: buildWatermark(link, { name: s.name, email: s.email, ip: ctx.ip ?? null }, new Date()),
    allow_download: link.allow_download,
  });
}

const BEAT_MS = 5000;

/**
 * Reading heartbeat. The client says how many ms of its own clock the beat covers (max 5 s) and whether
 * the reader was truly active (tab visible, window focused, input in the last 30 s). The server never
 * credits more than 5 s per beat, nor more than the real time since the previous beat, so forged or
 * flooded beats cannot inflate reading time.
 */
async function handleHeartbeat(req: Request, link: LinkRow): Promise<Response> {
  const s = readVisitor(req, link.slug, link.id);
  if (!s) return err(401, "auth", "Please verify your identity first.");
  // sendBeacon posts JSON as a Blob; req.json() handles both fetch and beacon bodies.
  const b = await readJson(req);
  const visitId = String(b.visit_id ?? "");
  const page = Number(b.page);
  const active = b.active === true;
  const clientMs = Math.min(Math.max(Number(b.ms) || 0, 0), BEAT_MS);
  if (!UUID_RE.test(visitId) || !Number.isInteger(page) || page < 1) return err(400, "invalid", "Bad request");

  const [v] = await db.sql<{ page_count: number; elapsed_ms: number | null }>`
    select dv.page_count,
           (extract(epoch from now() - v.last_heartbeat_at) * 1000)::int as elapsed_ms
    from visits v join document_versions dv on dv.id = v.version_id
    where v.id = ${visitId} and v.link_id = ${link.id} and v.visitor_id is not distinct from ${s.vid}::uuid`;
  if (!v || page > v.page_count) return err(404, "invalid", "Not found");

  const credit = active ? Math.min(clientMs, v.elapsed_ms ?? BEAT_MS) : 0;
  // page_views row exists as soon as a page is shown, even with 0 ms credit ("pages viewed").
  await db.sql`
    insert into page_views (visit_id, page, active_ms) values (${visitId}, ${page}, ${credit})
    on conflict (visit_id, page) do update set active_ms = page_views.active_ms + excluded.active_ms`;
  await db.sql`
    update visits set last_heartbeat_at = now(), total_active_ms = total_active_ms + ${credit},
                      max_page = greatest(max_page, ${page})
    where id = ${visitId}`;
  return json({ ok: true });
}

/**
 * Download: only when the link allows it. The original PDF is read from storage and stamped on the server with
 * the visitor's email and the time, so the browser never receives an unmarked file. Streamed because the file is
 * larger than the 4.5 MB limit for ordinary function responses.
 */
async function handleDownload(req: Request, ctx: Ctx, link: LinkRow, visitId?: string): Promise<Response> {
  if (!link.allow_download) return err(403, "nodl", "Downloads are not enabled for this link");
  const s = readVisitor(req, link.slug, link.id);
  if (!s || !visitId || !UUID_RE.test(visitId)) return err(404, "invalid", "Not found");
  const ip = ctx.ip ?? "unknown";
  if (await overLimit("download", ip, 20, 3600)) return err(429, "rate", "Too many downloads. Please try again later.");
  await record("download", ip);

  const [visit] = await db.sql<{ version_id: string; visitor_id: string | null; version_label: string }>`
    select v.version_id, v.visitor_id, dv.version_label from visits v join document_versions dv on dv.id = v.version_id
    where v.id = ${visitId} and v.link_id = ${link.id}`;
  if (!visit || (visit.visitor_id ?? null) !== (s.vid ?? null)) return err(404, "invalid", "Not found");

  const original = await files().get(`pdf/${visit.version_id}.pdf`, { type: "arrayBuffer" });
  if (!original) return err(404, "invalid", "Not found");
  const wmText = buildWatermark(link, { name: s.name, email: s.email, ip: ip === "unknown" ? null : ip }, new Date());
  const bytes = wmText ? await watermarkPdf(new Uint8Array(original), wmText) : new Uint8Array(original);

  const filename = `${link.doc_title}-${visit.version_label}.pdf`;
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "cache-control": "private, no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    },
  );
}

/** Page images and thumbnails: every request re-checks session, link state and document state. */
async function handleImage(req: Request, link: LinkRow, kind: "pages" | "thumbs", visitId?: string, n?: string) {
  const page = Number(n);
  if (!Number.isInteger(page) || page < 1) return err(404, "invalid", "Not found");
  if (visitId === "preview" && isAdminPreview(req)) {
    const docParam = new URL(req.url).searchParams.get("doc") ?? "";
    const roomDoc = link.room_id && docParam ? await resolveRoomDoc(link.room_id, docParam) : null;
    const version = roomDoc
      ? { id: roomDoc.version_id, page_count: roomDoc.page_count }
      : await resolveVersion(link);
    if (!version || page > version.page_count) return err(404, "invalid", "Not found");
    const img = await files().get(`${kind}/${version.id}/${page}.webp`, { type: "arrayBuffer" });
    if (!img) return err(404, "invalid", "Not found");
    return binary(img, "image/webp");
  }
  const s = readVisitor(req, link.slug, link.id);
  if (!s || !visitId || !UUID_RE.test(visitId)) return err(404, "invalid", "Not found");
  const [visit] = await db.sql<{ version_id: string; visitor_id: string | null }>`
    select version_id, visitor_id from visits where id = ${visitId} and link_id = ${link.id}`;
  if (!visit || (visit.visitor_id ?? null) !== (s.vid ?? null)) return err(404, "invalid", "Not found");
  const img = await files().get(`${kind}/${visit.version_id}/${page}.webp`, { type: "arrayBuffer" });
  if (!img) return err(404, "invalid", "Not found");
  return binary(img, "image/webp");
}

export default async (req: Request, ctx: Ctx): Promise<Response> => {
  try {
    if (!sameOrigin(req)) return fail(403, "Forbidden");
    const [slug, action, a, b] = new URL(req.url).pathname.replace(/^\/api\/v\//, "").split("/").filter(Boolean);
    const m = req.method;
    if (slug === "_" && action === "config" && m === "GET") {
      // Public, non-sensitive settings every page needs before anything else (branding, language, time zone).
      const b = await getBranding();
      return json({
        app_name: b.app_name,
        brand_color: b.brand_color,
        logo_url: b.logo_url,
        cta_label: b.cta_label,
        cta_url: b.cta_url,
        default_locale: config.defaultLocale,
        timezone: config.timezone,
      });
    }
    const link = slug ? await loadLinkBySlug(slug) : null;

    if (!link || !linkUsable(link)) {
      return action === "info" ? json({ status: "invalid" }) : err(404, "invalid", "This link is no longer available");
    }

    if (action === "info" && m === "GET") return await handleInfo(req, link);
    if (action === "room" && m === "GET") return await handleRoom(req, link);
    if (action === "room-thumb" && m === "GET") return await handleRoomThumb(req, link, a);
    if (action === "start" && m === "POST") return await handleStart(req, ctx, link);
    if (action === "verify" && m === "POST") return await handleVerify(req, ctx, link);
    if (action === "nda" && m === "GET") return await handleNda(req, link);
    if (action === "accept" && m === "POST") return await handleAccept(req, ctx, link);
    if (action === "open" && m === "POST") return await handleOpen(req, ctx, link);
    if (action === "heartbeat" && m === "POST") return await handleHeartbeat(req, link);
    if ((action === "pages" || action === "thumbs") && m === "GET") return await handleImage(req, link, action, a, b);
    if (action === "download" && m === "GET") return await handleDownload(req, ctx, link, a);
    return fail(404, "Not found");
  } catch (e) {
    console.error("visitor api error", e);
    return fail(500, "Server error");
  }
};

