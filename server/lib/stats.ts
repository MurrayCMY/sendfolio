import { config } from "./config";
import { db } from "./db";
import { fail, json, UUID_RE } from "./http";

// pg returns bigint as string; durations here are far below Number.MAX_SAFE_INTEGER.
const num = (v: unknown) => Number(v ?? 0);

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function recentVisits(): Promise<Response> {
  const rows = await db.sql<Row>`
    select v.id, v.started_at, v.last_heartbeat_at, v.total_active_ms, v.max_page, v.device, v.in_wechat,
           v.geo_city, v.geo_country, vis.id as visitor_id, vis.name as visitor_name, vis.email as visitor_email,
           l.id as link_id, l.name as link_name, d.id as document_id, d.title, dv.version_label, dv.page_count
    from visits v
    join links l on l.id = v.link_id
    join documents d on d.id = l.document_id
    join document_versions dv on dv.id = v.version_id
    left join visitors vis on vis.id = v.visitor_id
    order by v.started_at desc limit 20`;
  return json({ visits: rows.map((r) => ({ ...r, total_active_ms: num(r.total_active_ms) })) });
}

/** Per-page reading time for one version: average over all visits of that version (0 if the page was never reached). */
export async function documentStats(docId: string, versionId: string | null, linkId: string | null = null): Promise<Response> {
  const [ver] = versionId
    ? await db.sql<Row>`select id, version_label, page_count from document_versions
                        where id = ${versionId} and document_id = ${docId} and status = 'ready'`
    : await db.sql<Row>`select id, version_label, page_count from document_versions
                        where document_id = ${docId} and status = 'ready' order by created_at desc limit 1`;
  if (!ver) return json({ version: null, visits: 0, visitors: 0, pages: [] });

  const [totals] = await db.sql<Row>`
    select count(*)::int as visits, count(distinct visitor_id)::int as visitors
    from visits
    where version_id = ${ver.id}
      and (${linkId}::uuid is null or link_id = ${linkId}::uuid)
      and exists (select 1 from page_views p where p.visit_id = visits.id)`; // visits that were never tracked would only dilute the averages
  const rows = await db.sql<Row>`
    select g.page, coalesce(sum(pv.active_ms), 0)::bigint as total_ms, count(pv.visit_id)::int as viewers
    from generate_series(1, ${ver.page_count}::int) as g(page)
    left join (
      select p.* from page_views p join visits v on v.id = p.visit_id
      where v.version_id = ${ver.id} and (${linkId}::uuid is null or v.link_id = ${linkId}::uuid)
    ) pv on pv.page = g.page
    group by g.page order by g.page`;
  const visits = totals.visits as number;
  return json({
    version: ver,
    visits,
    visitors: totals.visitors,
    pages: rows.map((r) => ({
      page: r.page,
      avg_ms: visits ? Math.round(num(r.total_ms) / visits) : 0,
      viewers: r.viewers,
      reach: visits ? r.viewers / visits : 0,
    })),
  });
}

/** Visits of one document (all versions), optionally narrowed to one link. */
export async function documentVisits(docId: string, linkId: string | null): Promise<Response> {
  const rows = await db.sql<Row>`
    select v.id, v.started_at, v.last_heartbeat_at, v.total_active_ms, v.max_page, v.device, v.in_wechat,
           v.geo_city, v.geo_country, vis.id as visitor_id, vis.name as visitor_name, vis.email as visitor_email,
           l.id as link_id, l.name as link_name, d.id as document_id, d.title, dv.version_label, dv.page_count
    from visits v
    join links l on l.id = v.link_id
    join documents d on d.id = l.document_id
    join document_versions dv on dv.id = v.version_id
    left join visitors vis on vis.id = v.visitor_id
    where d.id = ${docId} and (${linkId}::uuid is null or l.id = ${linkId}::uuid)
    order by v.started_at desc limit 50`;
  return json({ visits: rows.map((r) => ({ ...r, total_active_ms: num(r.total_active_ms) })) });
}

/** Numbers for the overview page: last 7 days against the 7 before, a 14-day series, and things that need attention. */
export async function overview(): Promise<Response> {
  const [k] = await db.sql<Row>`
    select
      (select count(*)::int from visits where started_at > now() - interval '7 days') as visits_7d,
      (select count(*)::int from visits where started_at > now() - interval '14 days' and started_at <= now() - interval '7 days') as visits_prev_7d,
      (select count(distinct visitor_id)::int from visits where started_at > now() - interval '7 days') as visitors_7d,
      (select coalesce(avg(total_active_ms), 0)::bigint from visits v
        where v.started_at > now() - interval '7 days' and exists (select 1 from page_views p where p.visit_id = v.id)) as avg_ms_7d,
      (select count(*)::int from links l join documents d on d.id = l.document_id
        where l.enabled and d.archived_at is null and (l.expires_at is null or l.expires_at > now())) as active_links,
      (select count(*)::int from documents where archived_at is null) as documents,
      (select count(*)::int from nda_acceptances where accepted_at > now() - interval '7 days') as nda_7d`;
  const daily = await db.sql<Row>`
    select to_char((started_at at time zone ${config.timezone}::text)::date, 'YYYY-MM-DD') as day, count(*)::int as n
    from visits where started_at > now() - interval '15 days' group by 1 order by 1`;
  const expiring = await db.sql<Row>`
    select l.id, l.name, l.expires_at, d.id as document_id, d.title
    from links l join documents d on d.id = l.document_id
    where l.enabled and d.archived_at is null and l.expires_at > now() and l.expires_at < now() + interval '7 days'
    order by l.expires_at limit 5`;
  const [pending] = await db.sql<{ n: number }>`
    select count(*)::int as n from nda_acceptances where email_sent_at is null and accepted_at > now() - interval '2 days'`;
  // People worth a message: came back, or read deeply, in the last week - unless already in a meeting or declined.
  const followups = await db.sql<Row>`
    select * from (
      select vis.id, vis.name, vis.email, vis.status, count(v.id)::int as visits,
             coalesce(sum(v.total_active_ms), 0)::bigint as total_ms, max(v.started_at) as last_at,
             coalesce(max(v.max_page::float / nullif(dv.page_count, 0)), 0)::float as depth
      from visitors vis
      join visits v on v.visitor_id = vis.id
      join document_versions dv on dv.id = v.version_id
      where coalesce(vis.status, 'new') not in ('meeting', 'declined')
      group by vis.id
    ) t
    where t.last_at > now() - interval '7 days' and (t.visits >= 2 or t.depth >= 0.7)
    order by t.last_at desc limit 5`;
  // Links that were sent a while ago and never opened.
  const unopened = await db.sql<Row>`
    select l.id, l.name, l.created_at, d.id as document_id, d.title
    from links l join documents d on d.id = l.document_id
    where l.enabled and d.archived_at is null and (l.expires_at is null or l.expires_at > now())
      and l.created_at < now() - interval '3 days'
      and not exists (select 1 from visits v where v.link_id = l.id)
    order by l.created_at limit 5`;
  return json({
    kpi: { ...k, avg_ms_7d: num(k.avg_ms_7d) },
    daily,
    expiring,
    pending_nda_emails: pending.n,
    followups: followups.map((r) => ({ ...r, total_ms: num(r.total_ms), depth: Number(r.depth) })),
    unopened,
  });
}

/** Permanently deletes a link with its visit records. NDA acceptances stay (their link reference is cleared). */
export async function deleteLink(linkId: string): Promise<Response> {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("delete from page_views where visit_id in (select id from visits where link_id = $1)", [linkId]);
    const v = await client.query("delete from visits where link_id = $1", [linkId]);
    const l = await client.query("delete from links where id = $1", [linkId]);
    await client.query("COMMIT");
    if (!l.rowCount) return fail(404, "Link not found");
    return json({ deleted: true, visits_deleted: v.rowCount ?? 0 });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Permanently deletes a visitor and everything recorded about them: visits, per-page time, NDA signing records
 * and pending codes. Returns the signed-PDF keys so the caller can delete those files too.
 */
export async function deleteVisitor(visitorId: string): Promise<{ response: Response; pdfKeys: string[] }> {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const vis = await client.query("select email from visitors where id = $1", [visitorId]);
    if (!vis.rowCount) { await client.query("ROLLBACK"); return { response: fail(404, "Visitor not found"), pdfKeys: [] }; }
    const email = vis.rows[0].email as string;
    const acc = await client.query("select id from nda_acceptances where visitor_id = $1", [visitorId]);
    await client.query("delete from page_views where visit_id in (select id from visits where visitor_id = $1)", [visitorId]);
    const v = await client.query("delete from visits where visitor_id = $1", [visitorId]);
    await client.query("delete from nda_acceptances where visitor_id = $1", [visitorId]);
    await client.query("delete from otp_codes where purpose = 'visitor' and email = $1", [email]);
    await client.query("delete from visitors where id = $1", [visitorId]);
    await client.query("COMMIT");
    return {
      response: json({ deleted: true, visits_deleted: v.rowCount ?? 0, acceptances_deleted: acc.rowCount ?? 0 }),
      pdfKeys: acc.rows.map((r) => `nda-signed/v2/${String(r.id)}.pdf`),
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Permanently deletes visit records (and their per-page rows). NDA acceptances are kept. */
export async function deleteVisits(ids: unknown): Promise<Response> {
  const list = (Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === "string" && UUID_RE.test(x)).slice(0, 200);
  if (!list.length) return fail(400, "No records selected");
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("delete from page_views where visit_id = any($1::uuid[])", [list]);
    const r = await client.query("delete from visits where id = any($1::uuid[])", [list]);
    await client.query("COMMIT");
    return json({ deleted: r.rowCount ?? 0 });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function linkDetail(linkId: string): Promise<Response> {
  const [link] = await db.sql<Row>`
    select l.id, l.name, l.slug, l.enabled, l.expires_at, l.document_id, d.title
    from links l join documents d on d.id = l.document_id where l.id = ${linkId}`;
  if (!link) return fail(404, "Link not found");
  const visitors = await db.sql<Row>`
    select vis.id, vis.name, vis.email, count(v.id)::int as visits, coalesce(sum(v.total_active_ms), 0)::bigint as total_ms,
           max(v.started_at) as last_at,
           exists(select 1 from nda_acceptances a where a.visitor_id = vis.id and a.link_id = ${linkId}) as nda_signed
    from visits v join visitors vis on vis.id = v.visitor_id
    where v.link_id = ${linkId} group by vis.id, vis.name, vis.email order by max(v.started_at) desc`;
  const visits = await db.sql<Row>`
    select v.id, v.started_at, v.last_heartbeat_at, v.total_active_ms, v.max_page, v.device, v.in_wechat,
           v.geo_city, v.geo_country, vis.name as visitor_name, vis.email as visitor_email, dv.version_label, dv.page_count
    from visits v join document_versions dv on dv.id = v.version_id left join visitors vis on vis.id = v.visitor_id
    where v.link_id = ${linkId} order by v.started_at desc limit 100`;
  return json({
    link,
    visitors: visitors.map((r) => ({ ...r, total_ms: num(r.total_ms) })),
    visits: visits.map((r) => ({ ...r, total_active_ms: num(r.total_active_ms) })),
  });
}

export async function visitDetail(visitId: string): Promise<Response> {
  const [v] = await db.sql<Row>`
    select v.id, v.started_at, v.last_heartbeat_at, v.total_active_ms, v.max_page, v.device, v.in_wechat, v.user_agent,
           v.ip, v.geo_city, v.geo_country, v.version_id, vis.id as visitor_id, vis.name as visitor_name,
           vis.email as visitor_email, l.id as link_id, l.name as link_name, d.id as document_id, d.title,
           dv.version_label, dv.page_count
    from visits v
    join links l on l.id = v.link_id
    join documents d on d.id = l.document_id
    join document_versions dv on dv.id = v.version_id
    left join visitors vis on vis.id = v.visitor_id
    where v.id = ${visitId}`;
  if (!v) return fail(404, "Visit not found");
  const views = await db.sql<Row>`
    select page, active_ms, first_viewed_at from page_views where visit_id = ${visitId} order by page`;
  const byPage = new Map(views.map((r) => [r.page as number, num(r.active_ms)]));
  const pages = Array.from({ length: v.page_count as number }, (_, i) => ({ page: i + 1, active_ms: byPage.get(i + 1) ?? 0 }));
  const timeline = [...views]
    .sort((a, b) => +new Date(a.first_viewed_at) - +new Date(b.first_viewed_at))
    .map((r) => ({ page: r.page, at: r.first_viewed_at, active_ms: num(r.active_ms) }));
  return json({ visit: { ...v, total_active_ms: num(v.total_active_ms) }, pages, timeline });
}

export async function visitorsList(): Promise<Response> {
  const rows = await db.sql<Row>`
    select vis.id, vis.name, vis.email, vis.first_seen_at, vis.status, vis.note, count(v.id)::int as visits,
           count(distinct l.document_id)::int as documents, count(distinct v.link_id)::int as links,
           coalesce(sum(v.total_active_ms), 0)::bigint as total_ms, max(v.started_at) as last_at,
           coalesce(max(v.max_page::float / nullif(dv.page_count, 0)), 0)::float as depth,
           coalesce(array_agg(distinct d.title) filter (where d.title is not null), '{}') as docs,
           exists(select 1 from nda_acceptances a where a.visitor_id = vis.id) as nda_signed
    from visitors vis
    left join visits v on v.visitor_id = vis.id
    left join links l on l.id = v.link_id
    left join documents d on d.id = l.document_id
    left join document_versions dv on dv.id = v.version_id
    group by vis.id order by max(v.started_at) desc nulls last, vis.first_seen_at desc`;
  return json({ visitors: rows.map((r) => ({ ...r, total_ms: num(r.total_ms), depth: Number(r.depth) })) });
}

export async function visitorDetail(id: string): Promise<Response> {
  const [vis] = await db.sql<Row>`select id, name, email, first_seen_at, status, note from visitors where id = ${id}`;
  if (!vis) return fail(404, "Visitor not found");
  const visits = await db.sql<Row>`
    select v.id, v.started_at, v.last_heartbeat_at, v.total_active_ms, v.max_page, v.device, v.in_wechat,
           l.id as link_id, l.name as link_name, d.id as document_id, d.title, dv.version_label, dv.page_count
    from visits v join links l on l.id = v.link_id join documents d on d.id = l.document_id
    join document_versions dv on dv.id = v.version_id
    where v.visitor_id = ${id} order by v.started_at desc`;
  const acceptances = await db.sql<Row>`
    select a.id, a.accepted_at, n.label as nda_label, coalesce(a.link_name, l.name) as link_name
    from nda_acceptances a join nda_versions n on n.id = a.nda_version_id left join links l on l.id = a.link_id
    where a.visitor_id = ${id} order by a.accepted_at desc`;
  return json({
    visitor: vis,
    visits: visits.map((r) => ({ ...r, total_active_ms: num(r.total_active_ms) })),
    acceptances,
  });
}

export async function ndaAcceptances(): Promise<Response> {
  const rows = await db.sql<Row>`
    select a.id, a.visitor_id, a.name_as_entered, a.email, a.ip, a.accepted_at, a.email_sent_at,
           n.label as nda_label, coalesce(a.link_name, l.name) as link_name, coalesce(a.doc_title, d.title) as title
    from nda_acceptances a
    join nda_versions n on n.id = a.nda_version_id
    left join links l on l.id = a.link_id
    left join documents d on d.id = l.document_id
    order by a.accepted_at desc limit 500`;
  return json({ acceptances: rows });
}

/* ---------------- CSV export (UTF-8 with BOM so Excel opens non-ASCII text correctly) ---------------- */

const fmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});
const localTime = (v: unknown) => (v ? fmt.format(new Date(v as string)) : "");

/** Quote cells, and defuse spreadsheet formulas in untrusted text (names, titles). */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(filename: string, header: string[], rows: unknown[][]): Response {
  const body = "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

export async function exportVisits(docId: string | null, linkId: string | null = null): Promise<Response> {
  const rows = await db.sql<Row>`
    select v.id, d.title, dv.version_label, dv.page_count, l.name as link_name, vis.name, vis.email,
           v.started_at, v.last_heartbeat_at, v.total_active_ms, v.max_page, v.device, v.in_wechat, v.ip, v.geo_city, v.geo_country
    from visits v
    join links l on l.id = v.link_id
    join documents d on d.id = l.document_id
    join document_versions dv on dv.id = v.version_id
    left join visitors vis on vis.id = v.visitor_id
    where (${docId}::uuid is null or d.id = ${docId}::uuid) and (${linkId}::uuid is null or l.id = ${linkId}::uuid)
    order by v.started_at desc`;
  return csv(
    "visits.csv",
    ["Visit ID", "Document", "Version", "Link", "Name", "Email", `Started (${config.timezone})`, `Last activity (${config.timezone})`, "Active reading (s)", "Furthest page", "Total pages", "Device", "In WeChat", "IP", "City", "Country"],
    rows.map((r) => [
      r.id, r.title, r.version_label, r.link_name, r.name, r.email, localTime(r.started_at), localTime(r.last_heartbeat_at ?? r.started_at),
      Math.round(num(r.total_active_ms) / 1000), r.max_page, r.page_count, r.device, r.in_wechat ? "yes" : "no", r.ip, r.geo_city, r.geo_country,
    ]),
  );
}

export async function exportPageViews(docId: string | null, linkId: string | null = null): Promise<Response> {
  const rows = await db.sql<Row>`
    select v.id, d.title, dv.version_label, l.name as link_name, vis.name, vis.email, p.page, p.active_ms
    from page_views p
    join visits v on v.id = p.visit_id
    join links l on l.id = v.link_id
    join documents d on d.id = l.document_id
    join document_versions dv on dv.id = v.version_id
    left join visitors vis on vis.id = v.visitor_id
    where (${docId}::uuid is null or d.id = ${docId}::uuid) and (${linkId}::uuid is null or l.id = ${linkId}::uuid)
    order by v.started_at desc, p.page`;
  return csv(
    "page-views.csv",
    ["Visit ID", "Document", "Version", "Link", "Name", "Email", "Page", "Time on page (s)"],
    rows.map((r) => [r.id, r.title, r.version_label, r.link_name, r.name, r.email, r.page, Math.round(num(r.active_ms) / 100) / 10]),
  );
}
